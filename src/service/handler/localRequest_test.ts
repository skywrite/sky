import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { assert, test } from '#test'
import { fromTailnet, isLocalRequest, type RequestSource, throughTailnet } from './localRequest.ts'

const SKY = 'http://127.0.0.1:9999'
const OTHER_SITE = 'https://example.com'

test('a request is local when addressed to this Mac by name and not marked as another site', () => {
  const cases: Array<[given: string, source: RequestSource, expected: boolean]> = [
    ['a program on this Mac', { url: `${SKY}/graphql`, method: 'POST' }, true],
    ['a program using localhost', { url: 'http://localhost:9999/graphql', method: 'GET' }, true],
    ['a program using the IPv6 loopback', { url: 'http://[::1]:9999/graphql', method: 'GET' }, true],
    [
      'a Sky page saving',
      { url: `${SKY}/docs/_api/content/a.md`, method: 'PUT', origin: SKY, site: 'same-origin', mode: 'cors' },
      true,
    ],
    [
      'an address typed into the browser',
      { url: `${SKY}/day`, method: 'GET', site: 'none', mode: 'navigate', dest: 'document' },
      true,
    ],
    [
      'a link on another site',
      { url: `${SKY}/day`, method: 'GET', site: 'cross-site', mode: 'navigate', dest: 'document' },
      true,
    ],
    [
      'a page on another site reading',
      { url: `${SKY}/graphql`, method: 'GET', origin: OTHER_SITE, site: 'cross-site', mode: 'cors' },
      false,
    ],
    [
      'a page on another site posting without an origin',
      { url: `${SKY}/chat`, method: 'POST', site: 'cross-site', mode: 'no-cors', dest: 'empty' },
      false,
    ],
    [
      'a form on another site',
      {
        url: `${SKY}/chat`,
        method: 'POST',
        origin: OTHER_SITE,
        site: 'cross-site',
        mode: 'navigate',
        dest: 'document',
      },
      false,
    ],
    [
      'another site framing a page',
      { url: `${SKY}/day`, method: 'GET', site: 'cross-site', mode: 'navigate', dest: 'iframe' },
      false,
    ],
    [
      'a page on another port of this Mac',
      { url: `${SKY}/graphql`, method: 'POST', origin: 'http://127.0.0.1:8123', site: 'same-site', mode: 'cors' },
      false,
    ],
    [
      'a request addressed to another name',
      { url: 'http://example.com:9999/graphql', method: 'GET', origin: 'http://example.com:9999', site: 'same-origin' },
      false,
    ],
    ['a sandboxed page', { url: `${SKY}/graphql`, method: 'POST', origin: 'null', site: 'cross-site' }, false],
    ['an unreadable address', { url: 'http://exa mple/graphql', method: 'GET' }, false],
  ]
  for (const [given, source, expected] of cases)
    assert({
      given,
      should: expected ? 'let it through' : 'refuse it',
      actual: isLocalRequest(source),
      expected,
    })
})

const TAILNET = { host: 'atlas-mac.tail-example.ts.net', login: 'jane@example.com' }
const PHONE = `https://${TAILNET.host}`

/** A request as `tailscale serve` hands it to Sky: addressed to the Mac's tailnet name over plain HTTP. */
const served = (login: string | null, host = TAILNET.host, init: RequestInit = {}) =>
  new Request(`http://${host}/docs/_api/content/a.md`, {
    method: 'PUT',
    ...init,
    headers: {
      Origin: PHONE,
      'Sec-Fetch-Site': 'same-origin',
      ...(login ? { 'Tailscale-User-Login': login } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

test('a request tailscale serve brings from the owner is answered under the Mac’s tailnet name', () => {
  const owner = fromTailnet(served(TAILNET.login), TAILNET)
  const cases: Array<[given: string, request: Request, readdressed: boolean]> = [
    ['the owner’s phone', served(TAILNET.login), true],
    ['another person on the tailnet', served('joe@example.com'), false],
    ['no login, as from a device with no person behind it', served(null), false],
    ['the owner’s login, addressed to another name', served(TAILNET.login, 'other-mac.tail-example.ts.net'), false],
  ]
  assert({
    given: 'requests through tailscale serve',
    should: 'move only the owner’s to HTTPS under the Mac’s tailnet name, leaving the rest as they came',
    actual: cases.map(([given, request]) => [given, fromTailnet(request, TAILNET).url.startsWith('https:')]),
    expected: cases.map(([given, , readdressed]) => [given, readdressed]),
  })
  assert({
    given: 'the owner’s phone, and the same request while Tailscale is not running',
    should: 'keep the method and headers, and change nothing without a tailnet',
    actual: [owner.method, owner.headers.get('origin'), fromTailnet(served(TAILNET.login), null).url],
    expected: ['PUT', PHONE, `http://${TAILNET.host}/docs/_api/content/a.md`],
  })

  const check = (source: Partial<RequestSource>) =>
    isLocalRequest({ url: owner.url, method: 'PUT', origin: PHONE, site: 'same-origin', ...source })
  assert({
    given: 'the guard reading the owner’s re-addressed request, a page on another site, and the name over plain HTTP',
    should: 'let only the owner’s page through',
    actual: [
      check({ tailnetHost: TAILNET.host }),
      check({ tailnetHost: TAILNET.host, origin: 'https://example.com', site: 'cross-site' }),
      check({}),
      check({
        url: `http://${TAILNET.host}/docs/_api/content/a.md`,
        origin: `http://${TAILNET.host}`,
        tailnetHost: TAILNET.host,
      }),
    ],
    expected: [true, false, false, false],
  })
})

test('the server asks Tailscale who this Mac is only for requests that carry a login', async () => {
  let asked = 0
  const tailnet = async () => {
    asked++
    return TAILNET
  }
  const local = new Request('http://127.0.0.1:9999/day')
  const unchanged = await throughTailnet(local, tailnet)
  const phone = await throughTailnet(served(TAILNET.login), tailnet)
  const failing = await throughTailnet(served(TAILNET.login), async () => {
    throw new Error('Tailscale did not answer')
  })
  assert({
    given: 'a request from this Mac, one from the owner’s phone, and one while Tailscale fails',
    should: 'leave the first alone without asking, re-address the phone’s, and treat a failure as no tailnet',
    actual: [unchanged === local, phone.url.startsWith(PHONE), asked, failing.url.startsWith('http:')],
    expected: [true, true, 1, true],
  })
})

/** Sends one request by hand, so the Host header is exactly the tailnet name, and returns status and body. */
function send(port: number, headers: Record<string, string>, body: string): Promise<[number, string]> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/graphql', headers }, (response) => {
      let text = ''
      response.on('data', (chunk) => (text += chunk))
      response.on('end', () => resolve([response.statusCode ?? 0, text]))
    })
    request.on('error', reject)
    request.end(body)
  })
}

test('a save from the owner’s phone keeps its body when the running server re-addresses it', async () => {
  // The HTTP server swaps in its own Request and Response classes for the whole process; put them back after.
  const globals = { Request: globalThis.Request, Response: globalThis.Response }
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request: Request) => {
      const addressed = await throughTailnet(request, async () => TAILNET)
      return new Response(`${addressed.url} ${await addressed.text()}`)
    },
  })
  try {
    await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())))
    const { port } = server.address() as AddressInfo
    const body = '{"query":"{ __typename }"}'
    const answer = await send(
      port,
      { Host: TAILNET.host, 'Tailscale-User-Login': TAILNET.login, 'Content-Type': 'application/json' },
      body,
    )
    assert({
      given: 'a POST with a body, as tailscale serve hands it to the running server',
      should: 'reach the app under the HTTPS tailnet name with its body whole',
      actual: answer,
      expected: [200, `${PHONE}/graphql ${body}`],
    })
  } finally {
    server.close()
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value })
  }
})
