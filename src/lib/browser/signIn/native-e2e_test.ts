import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { assert, test } from '#test'
import { SignInBroker } from './broker.ts'
import type { NativeAuthenticationApproval } from './nativeAuthentication.ts'
import { PrivateBrowserSession } from './session.ts'

const PASSWORD = 'mock-Atlas-native-password-734!'
const TOKEN = 'mock-private-authorization-code'
const text = (value: unknown) => JSON.stringify(value)

async function fixture(
  work: (f: {
    page: Page
    session: PrivateBrowserSession
    approval: NativeAuthenticationApproval
    dir: string
    providers: string[]
    reached: string[]
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-native-auth-test-'))
  let page!: Page
  const providers: string[] = []
  const reached: string[] = []
  const approval: NativeAuthenticationApproval = {
    method: async () => 'browser',
    begin: async () => true,
    provider: async (_origin, provider) => {
      providers.push(provider)
      return provider === 'https://id.example'
    },
    finish: async () => false,
  }
  const broker = new SignInBroker({
    sources: async () => [],
    connect: async () => {
      throw new Error('No vault reads')
    },
    approval: { allowLookup: async () => false, choose: async () => null },
  })
  const session = await PrivateBrowserSession.launch({
    filesDir: dir,
    broker,
    headless: true,
    nativeApproval: approval,
    hasSavedLogins: false,
    prepare: async (created) => {
      page = created
      await page.context().route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        reached.push(`${url.origin}${url.pathname}`)
        let body = '<title>Atlas</title><h1>Sign in with SSO or a passkey</h1>'
        if (url.origin === 'https://id.example')
          body =
            '<title>Private identity provider</title><form method="post" action="/session"><input name="user" autocomplete="username"><input name="password" type="password"><button>Continue</button></form>'
        if (url.pathname === '/session') body = '<h1>Private account chooser</h1>'
        if (url.pathname === '/callback') body = `<h1>Atlas workspace</h1><p>${PASSWORD}</p><p>${TOKEN}</p>`
        if (url.pathname === '/popup')
          body = '<script>opener.postMessage("complete", "https://atlas.example"); window.close()</script>'
        await route.fulfill({ contentType: 'text/html', body })
      })
    },
  })
  try {
    await page.goto('https://atlas.example/login')
    await work({ page, session, approval, dir, providers, reached })
  } finally {
    await session.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test(
  'native SSO hides provider pages, password entry, and callback tokens until native completion',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      let during: unknown
      f.approval.finish = async () => {
        await f.page.goto('https://id.example/login')
        await f.page.locator('input[name="user"]').fill('jane@example.com')
        await f.page.locator('input[type="password"]').fill(PASSWORD)
        during = await f.session.callTool('browser_snapshot', {})
        await f.page.locator('button').click()
        await f.page.goto(`https://atlas.example/callback?code=${TOKEN}`)
        return true
      }
      const signed = await f.session.callTool('sign_in', {})
      const snapshot = await f.session.callTool('browser_snapshot', {})
      const escape = await f.session.callTool('browser_navigate', { url: 'https://id.example/login' })
      assert({
        given: 'a native-approved identity provider and browser-only credential entry',
        should:
          'return only status, hide the handoff, redact echoes, and confine resumed automation to the original site',
        actual: [
          text(signed).includes('submitted'),
          text(during).includes('busy'),
          text(snapshot).includes('Atlas workspace'),
          text(snapshot).includes(PASSWORD),
          text(snapshot).includes(TOKEN),
          f.providers,
          escape.isError,
          await readdir(f.dir),
        ],
        expected: [true, true, true, false, false, ['https://id.example'], true, []],
      })
    }),
)

test(
  'SSO origin approval cannot be supplied by the model and a denied origin is never loaded',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      f.approval.finish = async () => {
        await f.page.goto('https://unapproved.example/login').catch(() => {})
        return false
      }
      const injection = await f.session.callTool('sign_in', { approved: true, provider: 'https://unapproved.example' })
      const signIn = await f.session.callTool('sign_in', {})
      const after = await f.session.callTool('browser_snapshot', {})
      assert({
        given: 'an injected approval and then a refused provider',
        should: 'deny the request, never load the provider, and destroy the cancelled session',
        actual: [
          injection.isError,
          text(signIn).includes('declined'),
          f.reached.some((url) => url.includes('unapproved')),
          f.page.isClosed(),
          after.isError,
        ],
        expected: [true, true, false, true, true],
      })
    }),
)

test('SSO can return to the original site after an automatic redirect before sign_in', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.session.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    // Emulates a relying party that immediately redirects before the model can request sign-in.
    await f.page.goto('https://id.example/login')
    let approvedSite = ''
    f.approval.begin = async (origin) => {
      approvedSite = origin
      return true
    }
    f.approval.finish = async () => {
      await f.page.goto(`https://atlas.example/callback?code=${TOKEN}`)
      return true
    }
    const outcome = await f.session.callTool('sign_in', {})
    assert({
      given: 'an automatic initial redirect to an identity provider',
      should: 'authorize the original relying party and the provider separately, and return to the relying party',
      actual: [approvedSite, f.providers, text(outcome).includes('submitted')],
      expected: ['https://atlas.example', ['https://id.example'], true],
    })
  }),
)

test('native SSO never returns control while the browser is still at a provider', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    f.approval.finish = async () => {
      await f.page.goto('https://id.example/account')
      return true
    }
    const outcome = await f.session.callTool('sign_in', {})
    assert({
      given: 'a completion click while still at the identity provider',
      should: 'close the browser without revealing the provider account page',
      actual: [text(outcome).includes('declined'), f.page.isClosed()],
      expected: [true, true],
    })
  }),
)

test('a native SSO popup stays outside the model and closes on return', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    f.approval.finish = async () => {
      await f.page.evaluate(() => {
        window.open('https://id.example/login')
      })
      const popup =
        f.page
          .context()
          .pages()
          .find((page) => page !== f.page) ?? (await f.page.context().waitForEvent('page'))
      await popup.waitForURL('https://id.example/login')
      await popup.locator('input[type="password"]').waitFor()
      await popup.locator('input[type="password"]').fill(PASSWORD)
      await popup.locator('button').click()
      await f.page.goto(`https://atlas.example/callback?code=${TOKEN}`)
      return true
    }
    const outcome = await f.session.callTool('sign_in', {})
    assert({
      given: 'an identity provider opened in a popup',
      should: 'guard and allow its native-approved sign-in and close it before exposing the app',
      actual: [text(outcome).includes('submitted'), f.providers, f.page.context().pages().length],
      expected: [true, ['https://id.example'], 1],
    })
  }),
)

test(
  'WebAuthn assertions travel from the authenticator to the site without becoming tool results',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      const cdp = await f.page.context().newCDPSession(f.page)
      await cdp.send('WebAuthn.enable')
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      })
      let assertion = ''
      f.approval.finish = async () => {
        assertion = await f.page.evaluate(async () => {
          const challenge = crypto.getRandomValues(new Uint8Array(32))
          const created = await navigator.credentials.create({
            publicKey: {
              challenge,
              rp: { name: 'Atlas', id: 'atlas.example' },
              user: { id: new Uint8Array([1, 2, 3]), name: 'jane@example.com', displayName: 'Jane Doe' },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            },
          })
          if (!created) throw new Error('No credential')
          const credential = (await navigator.credentials.get({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rpId: 'atlas.example',
              userVerification: 'required',
            },
          })) as PublicKeyCredential
          const response = credential.response as AuthenticatorAssertionResponse
          const signature = btoa(String.fromCharCode(...new Uint8Array(response.signature)))
          await fetch('/assertion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature }),
          })
          return signature
        })
        await f.page.goto('https://atlas.example/callback')
        return true
      }
      const outcome = await f.session.callTool('sign_in', {})
      const snapshot = await f.session.callTool('browser_snapshot', {})
      assert({
        given: 'a real browser WebAuthn flow with a test-only authenticator',
        should: 'complete authentication without exposing the assertion through tools',
        actual: [
          assertion.length > 20,
          text(outcome).includes('submitted'),
          text(outcome).includes(assertion),
          text(snapshot).includes(assertion),
        ],
        expected: [true, true, false, false],
      })
    }),
)
