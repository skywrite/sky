import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type RequestListener } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'
import { browserBinary } from '../mcp/browserDriver.ts'
import { guardBrowserRequests } from './network.ts'
import { LoginRedactor } from './redaction.ts'

const listen = async (handler: RequestListener) => {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

test(
  'the private network guard blocks redirected credential POSTs and cross-origin navigation at every hop',
  { timeout: 30000 },
  async () => {
    const password = 'mock-private-password'
    const code = '246810'
    let escaped = 0
    const sink = await listen((_request, response) => {
      escaped++
      response.end('Unexpected request')
    })
    const source = await listen((request, response) => {
      if (request.url === '/redirect-post') response.writeHead(307, { location: `${sink.origin}/stolen` })
      else if (request.url === '/redirect-page') response.writeHead(302, { location: `${sink.origin}/page` })
      else if (request.url === '/same-origin') response.writeHead(302, { location: '/safe' })
      else response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<h1>Example site</h1>')
    })
    const browser = await chromium.launch({ executablePath: (await browserBinary()) ?? undefined, headless: true })
    try {
      const page = await browser.newPage()
      await guardBrowserRequests(page, {
        origin: () => source.origin,
        containsLogin: (text) => text.includes(password) || text.includes(code),
      })
      await page.goto(source.origin)
      const posted = await page.evaluate(async (password) => {
        try {
          await fetch('/redirect-post', { method: 'POST', body: password })
          return true
        } catch {
          return false
        }
      }, password)
      const postedCode = await page.evaluate(async (code) => {
        try {
          await fetch('/redirect-post', { method: 'POST', body: code })
          return true
        } catch {
          return false
        }
      }, code)
      await page.goto(`${source.origin}/same-origin`)
      const safePath = new URL(page.url()).pathname
      let navigated = true
      await page.goto(`${source.origin}/redirect-page`).catch(() => {
        navigated = false
      })
      assert({
        given: '307 redirects that preserve password and code bodies, a cross-origin 302, and a same-origin 302',
        should: 'block both origin escapes before any request reaches the sink, while allowing the safe redirect',
        actual: [posted, postedCode, navigated, escaped, safePath],
        expected: [false, false, false, 0, '/safe'],
      })
    } finally {
      await browser.close()
      source.server.close()
      sink.server.close()
    }
  },
)

test(
  'native SSO allows an assertion return but blocks password replay and unapproved redirect hops',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sky-sso-tls-'))
    const key = path.join(directory, 'test-key.pem')
    const cert = path.join(directory, 'test-cert.pem')
    const generated = await runCommand(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { timeout: 10000 },
    )
    if (!generated.success) throw new Error('Could not create synthetic TLS fixture')
    const tls = { key: await readFile(key), cert: await readFile(cert) }
    const servers: ReturnType<typeof createHttpsServer>[] = []
    const start = async (handler: RequestListener) => {
      const server = createHttpsServer(tls, handler)
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing TLS test address')
      return `https://127.0.0.1:${address.port}`
    }
    let callbacks = 0
    let escaped = 0
    const rp = await start((request, response) => {
      if (request.url === '/callback') callbacks++
      response.end('<h1>Atlas</h1>')
    })
    const sink = await start((_request, response) => {
      escaped++
      response.end('Unexpected')
    })
    const provider = await start((request, response) => {
      if (request.url === '/replay' || request.url === '/assertion')
        response.writeHead(307, { location: `${rp}/callback` })
      else if (request.url === '/detour') response.writeHead(302, { location: `${sink}/stolen` })
      response.end('<h1>Identity provider</h1>')
    })
    const browser = await chromium.launch({
      executablePath: (await browserBinary()) ?? undefined,
      headless: true,
      chromiumSandbox: true,
    })
    try {
      const page = await browser.newPage({ ignoreHTTPSErrors: true })
      page.setDefaultTimeout(5000)
      page.setDefaultNavigationTimeout(5000)
      const password = 'mock-Sso-password-274!'
      const redactor = new LoginRedactor()
      redactor.rememberText(password)
      await guardBrowserRequests(page, {
        origin: () => rp,
        containsLogin: (value) => redactor.contains(value) || value.includes('jane@example.com'),
        containsCredential: (value) => redactor.contains(value),
        nativeActive: () => true,
        authorizeNavigation: async (origin) => origin === rp || origin === provider,
      })
      await page.goto(provider)
      const post = async (route: string, value: string) => {
        await page.evaluate(
          ({ route, value }) => {
            const form = document.createElement('form')
            form.method = 'post'
            form.action = route
            const input = document.createElement('input')
            input.name = 'response'
            input.value = value
            form.append(input)
            document.body.append(form)
            form.submit()
          },
          { route, value },
        )
        await page.waitForLoadState('domcontentloaded').catch(() => {})
      }
      const assertionReturn = page.waitForURL(`${rp}/callback`)
      await post('/assertion', 'SAMLResponse=mock-assertion-for-jane@example.com')
      await assertionReturn
      await page.goto(provider)
      const refused = page.waitForEvent('requestfailed', {
        predicate: (request) => request.url() === `${rp}/callback` || request.url() === `${provider}/replay`,
      })
      await post('/replay', password)
      await refused
      await page.goto(`${provider}/detour`).catch(() => {})
      assert({
        given:
          'an approved SSO provider returning an assertion, replaying a password, and redirecting to an unapproved site',
        should: 'allow only the assertion return even when both password destinations are approved',
        actual: [callbacks, escaped],
        expected: [1, 0],
      })
    } finally {
      await browser.close()
      for (const server of servers) {
        server.closeAllConnections()
        server.close()
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
)
