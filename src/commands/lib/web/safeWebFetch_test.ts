import type { LookupAddress } from 'node:dns'
import { EventEmitter } from 'node:events'
import { IncomingMessage, type ClientRequest } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Socket } from 'node:net'
import { assert, test } from '#test'
import { createPublicPageFetcher, isPublicWebAddress, safeWebUrl, UnsafeWebUrlError } from './safeWebFetch.ts'

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

class MemoryRequest extends EventEmitter {
  destroyed = false
  constructor(private respond: () => void) {
    super()
  }
  end() {
    queueMicrotask(this.respond)
  }
  destroy(error?: Error) {
    if (!this.destroyed) {
      this.destroyed = true
      if (error) queueMicrotask(() => this.emit('error', error))
    }
    return this
  }
}

function transport(options: { status?: number; headers?: string[]; body?: string; open?: boolean } = {}) {
  const requests: { url: URL; options: RequestOptions; request: MemoryRequest; response: IncomingMessage }[] = []
  return {
    requests,
    request(url: URL, init: RequestOptions, receive: (message: IncomingMessage) => void): ClientRequest {
      const response = new IncomingMessage(new Socket())
      response.statusCode = options.status ?? 200
      response.rawHeaders = options.headers ?? ['Content-Type', 'text/plain']
      const request = new MemoryRequest(() => {
        receive(response)
        if (options.body) response.push(options.body)
        if (!options.open) response.push(null)
      })
      requests.push({ url, options: init, request, response })
      return request as unknown as ClientRequest
    },
  }
}

test('voice web URLs reject local names, credentials, nonstandard ports, and normalized IP evasions', () => {
  const unsafe = [
    'file:///tmp/notes.md',
    'ftp://example.com/page',
    'https://name:secret@example.com/',
    'https://@example.com/',
    'https://example.com:8080/',
    'http://example.com:443/',
    'http://localhost/',
    'http://localhost./',
    'http://printer.local/page',
    'https://service.internal/page',
    'https://host.home.arpa/page',
    'https://service.onion/page',
    'https://server/page',
    'https://bad..example.com/',
    'https://example.com\\@localhost/',
    ' https://example.com/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://169.254.169.254/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1%25en0]/',
  ]
  const rejected = unsafe.filter((url) => {
    try {
      safeWebUrl(url)
      return false
    } catch (error) {
      return error instanceof UnsafeWebUrlError && error.code === 'unsafe_url'
    }
  })
  assert({
    given: 'unsafe destinations and parser normalization tricks',
    should: 'reject every URL',
    actual: rejected,
    expected: unsafe,
  })
  assert({
    given: 'public HTTPS with its explicit default port and a fragment',
    should: 'normalize it to a fetchable page URL',
    actual: safeWebUrl('https://example.com:443/page?q=hello#section').href,
    expected: 'https://example.com/page?q=hello',
  })
})

test('voice web address checks exclude special IPv4 and IPv6 networks', () => {
  const blocked = [
    '0.1.2.3',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.9',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.254',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '100::1',
    '2001::1',
    '2001:1ff::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '3fff:fff::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    'not-an-address',
  ]
  const publicAddresses = [
    '8.8.8.8',
    '1.1.1.1',
    '100.128.0.1',
    '172.32.0.1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ]
  assert({
    given: 'private and special-use network addresses',
    should: 'block every address',
    actual: blocked.filter(isPublicWebAddress),
    expected: [],
  })
  assert({
    given: 'ordinary public addresses',
    should: 'allow each one',
    actual: publicAddresses.filter(isPublicWebAddress),
    expected: publicAddresses,
  })
})

test('voice page fetch validates every DNS answer before opening a socket', async () => {
  const network = transport()
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ],
  })
  const error = await rejection(fetchPage('https://example.com/page'))
  assert({
    given: 'mixed public and private DNS answers',
    should: 'reject without making a request',
    actual: [error instanceof UnsafeWebUrlError, network.requests.length],
    expected: [true, 0],
  })
})

test('voice page fetch pins the validated socket destination and preserves Host and TLS identity', async () => {
  const network = transport({ body: 'A public page.' })
  let resolutions = 0
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: async () => {
      resolutions++
      return [{ address: resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]
    },
  })
  const response = await fetchPage('https://example.com/page', {
    headers: { Cookie: 'secret', Authorization: 'secret', Host: 'localhost' },
  })
  const { options } = network.requests[0]
  let socketAddresses: unknown
  options.lookup!('example.com', { all: true }, (_error, addresses) => {
    socketAddresses = addresses
  })
  assert({
    given: 'a hostname whose later DNS result would be private',
    should: 'use only the already checked address and retain its public origin identity',
    actual: [
      await response.text(),
      resolutions,
      options.hostname,
      options.servername,
      options.agent,
      socketAddresses,
      options.headers,
    ],
    expected: [
      'A public page.',
      1,
      '8.8.8.8',
      'example.com',
      false,
      [{ address: '8.8.8.8', family: 4 }],
      {
        Host: 'example.com',
        Accept: 'text/html, text/plain;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Sky-Web-Research/1.0',
      },
    ],
  })
})

test('voice page fetch exposes redirects without following a private Location', async () => {
  const network = transport({ status: 302, headers: ['Location', 'http://127.0.0.1/admin'] })
  const fetchPage = createPublicPageFetcher({ ...network, resolve: async () => [{ address: '8.8.8.8', family: 4 }] })
  const response = await fetchPage('https://example.com/page')
  await response.body?.cancel()
  assert({
    given: 'a redirect to a private destination',
    should: 'return the raw redirect for caller validation',
    actual: [response.status, response.headers.get('location'), network.requests.length],
    expected: [302, 'http://127.0.0.1/admin', 1],
  })
})

test('voice page fetch pins a public IPv6 literal without DNS or TLS hostname rewriting', async () => {
  const network = transport({ body: 'A public page.' })
  let resolutions = 0
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: async () => {
      resolutions++
      return []
    },
  })
  const response = await fetchPage('https://[2606:4700:4700::1111]/page')
  const { options } = network.requests[0]
  await response.body?.cancel()
  assert({
    given: 'a public IPv6 literal destination',
    should: 'retain its bracketed HTTP host and connect to the validated address without DNS',
    actual: [
      resolutions,
      options.hostname,
      options.family,
      options.servername,
      new Headers(options.headers as Record<string, string>).get('host'),
    ],
    expected: [0, '2606:4700:4700::1111', 6, undefined, '[2606:4700:4700::1111]'],
  })
})

test('voice page fetch cancellation during DNS prevents a late socket connection', async () => {
  const network = transport()
  let finishLookup!: (addresses: LookupAddress[]) => void
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: () =>
      new Promise((resolve) => {
        finishLookup = resolve
      }),
  })
  const controller = new AbortController()
  const pending = rejection(fetchPage('https://example.com/page', { signal: controller.signal }))
  controller.abort(new Error('Call ended'))
  const error = await pending
  finishLookup([{ address: '8.8.8.8', family: 4 }])
  await Promise.resolve()
  assert({
    given: 'cancellation before DNS completes',
    should: 'propagate cancellation and never connect',
    actual: [error === controller.signal.reason, network.requests.length],
    expected: [true, 0],
  })
})

test('voice page fetch cancellation closes an in-progress response stream', async () => {
  const network = transport({ open: true })
  const fetchPage = createPublicPageFetcher({ ...network, resolve: async () => [{ address: '8.8.8.8', family: 4 }] })
  const controller = new AbortController()
  const response = await fetchPage('https://example.com/page', { signal: controller.signal })
  const reading = rejection(response.text())
  controller.abort(new Error('Call ended'))
  const error = await reading
  assert({
    given: 'cancellation after response headers',
    should: 'error the body and destroy both streams',
    actual: [error instanceof Error, network.requests[0].request.destroyed, network.requests[0].response.destroyed],
    expected: [true, true, true],
  })
})

test('voice page fetch body cancellation closes the underlying response', async () => {
  const network = transport({ body: 'The caller has enough bytes.', open: true })
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  })
  const response = await fetchPage('https://example.com/page')
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  assert({
    given: 'a caller stopping after its byte budget is reached',
    should: 'destroy the source stream instead of downloading the remaining page',
    actual: network.requests[0].response.destroyed,
    expected: true,
  })
})

test('voice page fetch prevents body writes and credentialed requests', async () => {
  const network = transport()
  let resolutions = 0
  const fetchPage = createPublicPageFetcher({
    ...network,
    resolve: async () => {
      resolutions++
      return []
    },
  })
  const results = await Promise.all([
    rejection(fetchPage('https://example.com/page', { method: 'POST' })),
    rejection(fetchPage('https://example.com/page', { body: 'private notes' })),
    rejection(fetchPage('https://example.com/page', { credentials: 'include' })),
  ])
  assert({
    given: 'requests with unsupported side effects',
    should: 'reject before DNS or transport access',
    actual: [results.every((error) => error instanceof Error), resolutions, network.requests.length],
    expected: [true, 0, 0],
  })
})
