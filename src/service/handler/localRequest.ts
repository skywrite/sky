import type { MiddlewareHandler } from 'hono'

/** The names this service answers to; it listens on the loopback interface only. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

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
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false
  if (source.origin && source.origin !== url.origin) return false
  const site = source.site?.toLowerCase()
  if (!site || site === 'same-origin' || site === 'none') return true
  return (
    (source.method === 'GET' || source.method === 'HEAD') &&
    source.mode?.toLowerCase() === 'navigate' &&
    source.dest?.toLowerCase() === 'document'
  )
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
    })
    if (!local) return c.json({ message: 'Open Sky directly on this Mac.' }, 403)
    await next()
  }
}
