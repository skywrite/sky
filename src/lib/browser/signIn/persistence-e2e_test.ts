import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import { assert, test } from '#test'
import { SignInBroker } from './broker.ts'
import { PrivateBrowserSession } from './session.ts'

const origin = 'https://atlas.example'
const loginForm =
  '<form method="post" action="/session"><label>Email<input autocomplete="username" name="email"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>'

test(
  'a signed-in profile survives finished and cancelled runs, while explicit sign-out persists',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-browser-persistence-'))
    const profileDir = path.join(root, 'profile')
    const filesDir = path.join(root, 'files')
    let page!: Page
    let browser: PrivateBrowserSession | undefined
    let lookups = 0
    let reads = 0
    const launch = async (executablePath?: string) => {
      browser = await PrivateBrowserSession.launch({
        profileDir,
        filesDir,
        headless: true,
        executablePath,
        broker: new SignInBroker({
          sources: async () => [{ id: 'example', account: 'example', label: 'Example account', excludedVaultIds: [] }],
          approval: {
            allowLookup: async () => {
              lookups++
              return true
            },
            choose: async () => 0,
          },
          connect: async () => ({
            list: async () => ({
              issues: [],
              items: [
                {
                  ref: { connectionId: 'example', containerId: 'vault', itemId: 'login' },
                  title: 'Atlas',
                  nativeCategory: 'Login',
                  tags: [],
                  websites: [{ url: origin, match: 'exact' }],
                },
              ],
            }),
            readLogin: async () => {
              reads++
              return {
                username: new SensitiveValue('jane@example.com'),
                password: new SensitiveValue('synthetic-password'),
              }
            },
          }),
        }),
        prepare: async (created) => {
          page = created
          await page.context().route('**/*', async (route) => {
            const request = route.request()
            const url = new URL(request.url())
            if (url.pathname === '/session' && request.method() === 'POST') {
              await route.fulfill({
                contentType: 'text/html',
                headers: {
                  'set-cookie':
                    'session=synthetic-session; Path=/; Secure; HttpOnly\nremember=synthetic-remember; Path=/; Secure; HttpOnly; Max-Age=86400',
                },
                body: '<title>Atlas account</title><h1>Signed in</h1><script>localStorage.setItem("account", "Atlas")</script>',
              })
            } else if (url.pathname === '/sign-out') {
              await route.fulfill({
                contentType: 'text/html',
                headers: {
                  'set-cookie':
                    'session=; Path=/; Secure; HttpOnly; Max-Age=0\nremember=; Path=/; Secure; HttpOnly; Max-Age=0',
                },
                body: loginForm,
              })
            } else {
              const cookies = request.headers().cookie ?? ''
              const signedIn =
                cookies.includes('session=synthetic-session') && cookies.includes('remember=synthetic-remember')
              await route.fulfill({
                contentType: 'text/html',
                body: signedIn ? '<title>Atlas account</title><h1>Signed in</h1>' : loginForm,
              })
            }
          })
        },
      })
      return browser
    }
    try {
      let run = await launch()
      await run.callTool('browser_navigate', { url: `${origin}/login` })
      const signed = await run.callTool('sign_in', {})
      assert({
        given: 'a first approved sign-in',
        should: 'complete once and save both kinds of cookie',
        actual: [JSON.stringify(signed).includes('submitted'), (await page.context().cookies(origin)).length],
        expected: [true, 2],
      })
      await run.close()
      const failedLaunch = await launch(path.join(root, 'missing-browser')).then(
        () => false,
        () => true,
      )
      assert({
        given: 'a browser launch failure after a successful sign-in',
        should: 'report the failure and retain the saved profile',
        actual: [failedLaunch, (await stat(path.join(profileDir, 'sky-session-cookies.json'))).isFile()],
        expected: [true, true],
      })
      run = await launch()
      await run.callTool('browser_navigate', { url: `${origin}/account` })
      const snapshot = await run.callTool('browser_snapshot', {})
      assert({
        given: 'a new browser run after the first one closed',
        should: 'reach the signed-in account with preserved site storage and no further credential lookup',
        actual: [
          JSON.stringify(snapshot).includes('Signed in'),
          await page.evaluate(() => localStorage.getItem('account')),
          lookups,
          reads,
          (await stat(profileDir)).mode & 0o777,
          (await stat(path.join(profileDir, 'sky-session-cookies.json'))).mode & 0o777,
          await readdir(filesDir),
        ],
        expected: [true, 'Atlas', 1, 1, 0o700, 0o600, []],
      })
      const controller = new AbortController()
      const closed = page.waitForEvent('close', { timeout: 5000 })
      const waiting = run.callTool('browser_wait_for', { time: 10 }, { signal: controller.signal })
      controller.abort()
      await waiting
      await closed
      await run.close()
      run = await launch()
      await run.callTool('browser_navigate', { url: `${origin}/account` })
      assert({
        given: 'a cancelled prior run',
        should: 'keep the sign-in for the next run',
        actual: [JSON.stringify(await run.callTool('browser_snapshot', {})).includes('Signed in'), reads],
        expected: [true, 1],
      })
      await run.callTool('browser_navigate', { url: `${origin}/sign-out` })
      await run.close()
      run = await launch()
      await run.callTool('browser_navigate', { url: `${origin}/account` })
      assert({
        given: 'an explicit website sign-out',
        should: 'remain signed out after relaunch without restoring old cookies',
        actual: [
          JSON.stringify(await run.callTool('browser_snapshot', {})).includes('Signed in'),
          (await page.context().cookies(origin)).length,
        ],
        expected: [false, 0],
      })
    } finally {
      await browser?.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
