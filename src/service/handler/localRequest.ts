import type { MiddlewareHandler } from 'hono'
import type { Tailnet } from '#lib/tailscale/identity.ts'

/** The names this service answers to; it listens on the loopback interface only. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The header `tailscale serve` sets to the requester's login, replacing any the device sent. */
const TAILSCALE_LOGIN = 'tailscale-user-login'

/** Where a request says it comes from: the address it was sent to and the headers a browser attaches. */
export interface RequestSource {
  /** Absolute request URL; its host is the name the request was addressed to */
  url: string
  method: string
  origin?: string | null
  /** Sec-Fetch-Site, Sec-Fetch-Mode and Sec-Fetch-Dest, as browsers send them */
  site?: string | null
  mode?: string | null
  dest?: string | null
  /** This Mac's tailnet name, when the request came from the owner through `tailscale serve` (see fromTailnet) */
  tailnetHost?: string
}

/**
 * A request is local when it is addressed to this Mac by name and no browser marks it as another
 * site's. Programs on this Mac send no browser headers; Sky's own pages are same-origin. A link on
 * another site may still open a page: a top-level GET, which returns nothing to that site.
 */
export function isLocalRequest(source: RequestSource): boolean {
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return false
  }
  const named =
    LOOPBACK_HOSTS.has(url.hostname) ||
    (!!source.tailnetHost && url.protocol === 'https:' && url.hostname === source.tailnetHost)
  if (!named) return false
  if (source.origin && source.origin !== url.origin) return false
  const site = source.site?.toLowerCase()
  if (!site || site === 'same-origin' || site === 'none') return true
  return (
    (source.method === 'GET' || source.method === 'HEAD') &&
    source.mode?.toLowerCase() === 'navigate' &&
    source.dest?.toLowerCase() === 'document'
  )
}

/**
 * This Mac's tailnet name when a request carries it and the owner's login. `tailscale serve` runs on
 * this Mac, keeps the name the device asked for, and sets the login itself.
 */
export function ownerTailnetHost(
  host: string | null | undefined,
  login: string | null | undefined,
  tailnet: Tailnet | null,
): string | undefined {
  if (!tailnet || !host || login !== tailnet.login) return undefined
  try {
    return new URL(`http://${host}`).hostname === tailnet.host ? tailnet.host : undefined
  } catch {
    return undefined
  }
}

/** Requests fromTailnet re-addressed, and the name each came by. */
const tailnetHosts = new WeakMap<Request, string>()

/**
 * A request from one of the owner's devices through `tailscale serve`, re-addressed to HTTPS under
 * this Mac's tailnet name: the page on the device is HTTPS, so its Origin then matches the request's
 * address wherever Sky compares them. Any other request is returned as it came.
 */
export function fromTailnet(request: Request, tailnet: Tailnet | null): Request {
  const url = new URL(request.url)
  const host =
    url.protocol === 'http:' ? ownerTailnetHost(url.host, request.headers.get(TAILSCALE_LOGIN), tailnet) : undefined
  if (!host) return request
  url.protocol = 'https:'
  // Spelled out rather than copied from the request: the HTTP server's own Request class cannot be
  // built from another request that has a body.
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : request.body
  const addressed = new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit)
  tailnetHosts.set(addressed, host)
  return addressed
}

/** fromTailnet for the server: Tailscale is asked who this Mac is only when a request carries a login. */
export async function throughTailnet(request: Request, tailnet?: () => Promise<Tailnet | null>): Promise<Request> {
  if (!tailnet || !request.headers.has(TAILSCALE_LOGIN)) return request
  return fromTailnet(request, await tailnet().catch(() => null))
}

/** Answers every request that is not local with 403, before any route sees it. */
export function localRequestsOnly(): MiddlewareHandler {
  return async (c, next) => {
    const local = isLocalRequest({
      url: c.req.url,
      method: c.req.method,
      origin: c.req.header('Origin'),
      site: c.req.header('Sec-Fetch-Site'),
      mode: c.req.header('Sec-Fetch-Mode'),
      dest: c.req.header('Sec-Fetch-Dest'),
      tailnetHost: tailnetHosts.get(c.req.raw),
    })
    if (!local) return c.json({ message: 'Open Sky directly on this Mac.' }, 403)
    await next()
  }
}
