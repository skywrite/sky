import { createServer, type RequestListener } from 'node:http'
import { chromium } from 'playwright'
import { assert, test } from '#test'
import { browserBinary } from '../mcp/browserDriver.ts'
import { guardBrowserRequests } from './network.ts'

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
