import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

export class UnsafeWebUrlError extends Error {
  readonly code = 'unsafe_url'

  constructor() {
    super('Only public HTTP or HTTPS pages on their default ports can be read.')
    this.name = 'UnsafeWebUrlError'
  }
}

/** Deliberately conservative: exclude special-use and transition networks as well as private addresses. */
export function isPublicWebAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (family !== 6 || address.includes('%')) return false
  // Public unicast occupies 2000::/3. All IPv4-mapped, local, multicast, and NAT64 addresses fall outside it.
  const [first, second = '0'] = address.split(':')
  const a = Number.parseInt(first, 16)
  const b = Number.parseInt(second || '0', 16)
  return (
    a >= 0x2000 &&
    a <= 0x3fff &&
    !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) &&
    a !== 0x2002 &&
    !(a === 0x3fff && b <= 0x0fff)
  )
}

export function safeWebUrl(input: string): URL {
  if (input.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(input)) throw new UnsafeWebUrlError()
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new UnsafeWebUrlError()
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    input.match(/^[a-z]+:\/\/([^/?#]*)/i)?.[1].includes('@')
  )
    throw new UnsafeWebUrlError()
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(host)) {
    if (!isPublicWebAddress(host)) throw new UnsafeWebUrlError()
  } else {
    if (
      !host.includes('.') ||
      host.length > 253 ||
      host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      /(?:^|\.)(?:localhost|local|localdomain|localnet|internal|intranet|lan|home|corp|private|arpa|onion|test|invalid|example)$/i.test(
        host,
      )
    )
      throw new UnsafeWebUrlError()
  }
  url.hash = ''
  return url
}

interface PublicPageDependencies {
  resolve?: (hostname: string) => Promise<LookupAddress[]>
  request?: (url: URL, options: HttpsRequestOptions, response: (message: IncomingMessage) => void) => ClientRequest
}

function pageBody(message: IncomingMessage): ReadableStream<Uint8Array> {
  const reader = Readable.toWeb(message).getReader()
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (cancelled) return
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      } catch (error) {
        if (!cancelled) controller.error(error)
      }
    },
    cancel(reason) {
      cancelled = true
      // Bun's Node stream adapter can otherwise enqueue already buffered data after cancellation.
      message.pause()
      return reader.cancel(reason)
    },
  })
}

/** Injection stays at the DNS/socket boundary so tests exercise the production URL and address checks. */
export function createPublicPageFetcher(dependencies: PublicPageDependencies = {}) {
  const resolveHost = dependencies.resolve ?? ((host: string) => lookup(host, { all: true, order: 'verbatim' }))
  const request =
    dependencies.request ??
    ((url: URL, options: HttpsRequestOptions, response: (message: IncomingMessage) => void) =>
      (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, response))

  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = safeWebUrl(input)
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET' || init?.body != null || init?.credentials === 'include')
      throw new Error('Public page reads only support GET without credentials or a body.')
    const signal = AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)])
    signal.throwIfAborted()
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    return new Promise<Response>((resolve, reject) => {
      let outgoing: ClientRequest | undefined
      let incoming: IncomingMessage | undefined
      const cleanup = () => signal.removeEventListener('abort', abort)
      const fail = (error: unknown) => {
        cleanup()
        const reason = error instanceof Error ? error : new Error('Public page request failed.')
        incoming?.pause()
        incoming?.destroy(reason)
        outgoing?.destroy(reason)
        reject(error)
      }
      const abort = () => fail(signal.reason)
      signal.addEventListener('abort', abort, { once: true })

      const addresses = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolveHost(host)
      addresses
        .then((resolved) => {
          signal.throwIfAborted()
          if (!resolved.length || resolved.some(({ address }) => !isPublicWebAddress(address)))
            throw new UnsafeWebUrlError()
          const pinned = { address: resolved[0].address, family: isIP(resolved[0].address) }
          outgoing = request(
            url,
            {
              method: 'GET',
              hostname: pinned.address,
              family: pinned.family,
              servername: isIP(host) ? undefined : host,
              // A new socket ensures a pooled connection cannot bypass this request's validation.
              agent: false,
              headers: {
                Host: url.host,
                Accept: 'text/html, text/plain;q=0.9',
                'Accept-Encoding': 'identity',
                'User-Agent': 'Sky-Web-Research/1.0',
              },
              // Resolve once and connect to that checked address while preserving URL Host and TLS identity.
              lookup: (_hostname, options, callback) => {
                if (options.all) callback(null, [pinned])
                else callback(null, pinned.address, pinned.family)
              },
            },
            (message) => {
              incoming = message
              message.once('end', cleanup)
              message.once('close', cleanup)
              message.once('error', fail)
              try {
                signal.throwIfAborted()
                const headers = new Headers()
                for (let i = 0; i < message.rawHeaders.length; i += 2)
                  headers.append(message.rawHeaders[i], message.rawHeaders[i + 1])
                const status = message.statusCode ?? 502
                const empty = [204, 205, 304].includes(status)
                const body = empty ? null : pageBody(message)
                const response = new Response(body, { status, headers })
                if (empty) message.destroy()
                resolve(response)
              } catch (error) {
                fail(error)
              }
            },
          )
          outgoing.once('error', fail)
          outgoing.end()
        })
        .catch(fail)
    })
  }
}

/** Returns redirects untouched. The caller must validate each Location and cap redirects and body bytes. */
export const fetchPublicPage = createPublicPageFetcher()
