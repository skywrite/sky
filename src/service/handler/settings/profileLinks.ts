import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const reserved = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  reserved.addSubnet(address, prefix, 'ipv4')
reserved.addSubnet('2001:db8::', 32, 'ipv6')
reserved.addSubnet('2002::', 16, 'ipv6')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

export function isPublicProfileAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return !reserved.check(address, 'ipv4')
  return version === 6 && globalV6.check(address, 'ipv6') && !reserved.check(address, 'ipv6')
}

function publicUrl(value: string): URL {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error('Use a public website URL.')
  return url
}

function visibleText(raw: string): string {
  return raw
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|apos);/g,
      (entity) =>
        ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity: string, value: string) => {
      const point = value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16_000)
}

/** Resolve and pin each redirect separately: profile links never reach the local service or private network. */
export async function readProfilePage(value: string): Promise<string> {
  let url = publicUrl(value)
  const signal = AbortSignal.timeout(15_000)
  for (let redirect = 0; redirect < 4; redirect++) {
    signal.throwIfAborted()
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      void lookup(hostname, { all: true })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort))
    })
    if (!addresses.length || addresses.some((item) => !isPublicProfileAddress(item.address)))
      throw new Error('Use a public website.')
    const address = addresses.find((item) => item.family === 4) ?? addresses[0]
    const result = await new Promise<{ location?: string; text?: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          signal,
          family: address.family,
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
          headers: { 'User-Agent': 'Sky/1.0 (profile reader)', Accept: 'text/html, text/plain' },
        },
        (response) => {
          response.on('error', reject)
          const status = response.statusCode ?? 0
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume()
            resolve({ location: response.headers.location })
            return
          }
          const type = response.headers['content-type'] ?? ''
          if (status < 200 || status >= 300 || !/^(text\/(html|plain)|application\/xhtml\+xml)\b/i.test(type)) {
            response.resume()
            reject(new Error('This page is not publicly readable text.'))
            return
          }
          let size = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 1_000_000) {
              request.destroy(new Error('This page is too large.'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => resolve({ text: visibleText(Buffer.concat(chunks).toString('utf8')) }))
        },
      )
      request.on('error', reject)
      request.end()
    })
    if (result.location) {
      url = publicUrl(new URL(result.location, url).href)
      continue
    }
    if (!result.text) throw new Error('This page had no readable text.')
    return result.text
  }
  throw new Error('This page redirected too many times.')
}
