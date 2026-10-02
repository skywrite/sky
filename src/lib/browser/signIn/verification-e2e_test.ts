import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Item } from '@1password/sdk'
import type { Page } from 'playwright'
import {
  OnePasswordCredentialProvider,
  type OnePasswordClient,
} from '#lib/credentials/providers/OnePasswordCredentialProvider.ts'
import { assert, test } from '#test'
import { buildActionTable } from '../jev/table.ts'
import { SignInBroker, type SignInBrokerOptions } from './broker.ts'
import { PrivateBrowserSession } from './session.ts'

const ORIGIN = 'https://atlas.example'
const USERNAME = 'jane@example.com'
const PASSWORD = 'mock-Atlas-password-497!'
const CODE = '246810'
const LOGIN =
  '<form method="post" action="/challenge"><label>Email<input name="email" autocomplete="username"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>'
const CHALLENGE =
  '<main><h1>Two-step verification</h1><form method="post" action="/verified"><label>Authenticator code<input name="otp" autocomplete="one-time-code"></label><button>Verify</button></form></main>'

async function fixture(
  work: (f: {
    browser: PrivateBrowserSession
    page: Page
    dir: string
    item: Item
    counts: { approval: number; reads: number; passwords: number; codes: number }
    options: SignInBrokerOptions
    controls: { challenge: string; reject: boolean; onCodeRead?: () => Promise<void> }
    signIn(): Promise<unknown>
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-verification-test-'))
  const counts = { approval: 0, reads: 0, passwords: 0, codes: 0 }
  const controls: { challenge: string; reject: boolean; onCodeRead?: () => Promise<void> } = {
    challenge: CHALLENGE,
    reject: false,
  }
  const item = {
    id: 'login',
    vaultId: 'example-vault',
    category: 'Login',
    title: 'Atlas',
    version: 1,
    tags: [],
    sections: [],
    websites: [{ url: ORIGIN, autofillBehavior: 'ExactDomain' }],
    fields: [
      { id: 'username', title: 'Username', fieldType: 'Text', value: USERNAME },
      { id: 'password', title: 'Password', fieldType: 'Concealed', value: PASSWORD },
      {
        id: 'otp',
        title: 'Authenticator',
        fieldType: 'Totp',
        value: 'mock-seed',
        details: { type: 'Otp', content: { code: CODE } },
      },
    ],
  } as unknown as Item
  const provider = new OnePasswordCredentialProvider(
    {
      vaults: { list: async () => [{ id: 'example-vault', title: 'Example vault' }] },
      items: {
        list: async () => [{ ...item, state: 'active' }],
        get: async () => {
          counts.reads++
          if (counts.reads > 1) await controls.onCodeRead?.()
          return structuredClone(item)
        },
      },
    } as unknown as OnePasswordClient,
    { id: 'example' },
  )
  const options: SignInBrokerOptions = {
    sources: async () => [{ id: 'example', account: 'example-account', label: 'Example', excludedVaultIds: [] }],
    connect: async () => provider,
    approval: {
      allowLookup: async () => true,
      choose: async () => {
        counts.approval++
        return 0
      },
    },
  }
  let page!: Page
  const browser = await PrivateBrowserSession.launch({
    filesDir: dir,
    headless: true,
    broker: new SignInBroker(options),
    prepare: async (created) => {
      page = created
      await page.context().route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const values = new URLSearchParams(request.postData() ?? '')
        if (url.pathname === '/embedded') {
          await route.fulfill({ contentType: 'text/html', body: CHALLENGE })
        } else if (url.pathname === '/challenge') {
          if (request.method() === 'POST' && values.get('email') === USERNAME && values.get('password') === PASSWORD)
            counts.passwords++
          await route.fulfill({ contentType: 'text/html', body: controls.challenge })
        } else if (url.pathname === '/verified') {
          if (request.method() === 'POST' && values.get('otp') === CODE) counts.codes++
          await route.fulfill({
            contentType: 'text/html',
            body: controls.reject
              ? controls.challenge
              : `<h1>Signed in</h1><p>${USERNAME} ${PASSWORD} ${CODE} ${btoa(CODE)}</p><a href="data:text/plain,${CODE}" download="echo.txt">Download echo</a>`,
          })
        } else await route.fulfill({ contentType: 'text/html', body: LOGIN })
      })
    },
  })
  try {
    await work({
      browser,
      page,
      dir,
      item,
      counts,
      options,
      controls,
      signIn: async () => {
        await browser.callTool('browser_navigate', { url: `${ORIGIN}/login` })
        const reply = await browser.callTool('sign_in', {})
        await page.waitForURL(`${ORIGIN}/challenge`)
        return reply
      },
    })
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test(
  'approved password sign-in continues with one fresh code entirely inside the browser',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      const login = await f.signIn()
      const verification = await f.browser.callTool('browser_snapshot', {})
      await f.page.waitForURL(`${ORIGIN}/verified`)
      const after = await f.browser.callTool('browser_snapshot', {})
      const download = f.page.waitForEvent('download')
      await f.page.getByRole('link', { name: 'Download echo' }).click()
      await download
      const downloaded = await f.browser.callTool('browser_snapshot', {})
      const output = JSON.stringify([login, verification, after, downloaded])
      assert({
        given: 'an approved login followed by a supported authenticator challenge',
        should: 'finish once, redact reflected codes and credentials, and withhold code downloads',
        actual: [
          f.counts,
          output.includes('Signed in'),
          [USERNAME, PASSWORD, CODE, btoa(CODE), 'mock-seed'].some((value) => output.includes(value)),
          await readdir(f.dir),
          buildActionTable((verification.content[0] as { text: string }).text).url.startsWith(ORIGIN),
        ],
        expected: [{ approval: 1, reads: 2, passwords: 1, codes: 1 }, true, false, [], true],
      })
    }),
)

test(
  'missing codes, SMS, email, split controls, and prefilled fields retain a private manual handoff',
  { timeout: 60000 },
  async () => {
    for (const reason of [
      'no-code',
      'ambiguous-code',
      'sms',
      'sms-without-main',
      'email',
      'split',
      'prefilled',
      'get',
      'external-action',
      'embedded',
    ] as const) {
      await fixture(async (f) => {
        if (reason === 'no-code') f.item.fields = f.item.fields.filter((field) => field.fieldType !== 'Totp')
        if (reason === 'ambiguous-code') f.item.fields.push({ ...f.item.fields[2], id: 'second-code' })
        if (reason === 'sms')
          f.controls.challenge = CHALLENGE.replace('Two-step verification', 'Enter the SMS code sent to your phone')
        if (reason === 'sms-without-main')
          f.controls.challenge = CHALLENGE.replace('<main>', '')
            .replace('</main>', '')
            .replace('Two-step verification', 'Enter the code from your phone')
        if (reason === 'email')
          f.controls.challenge = CHALLENGE.replace('Two-step verification', 'We sent a code to your email')
        if (reason === 'split')
          f.controls.challenge = CHALLENGE.replace('</label>', '<input autocomplete="one-time-code"></label>')
        if (reason === 'prefilled') f.controls.challenge = CHALLENGE.replace('name="otp"', 'name="otp" value="135790"')
        if (reason === 'get') f.controls.challenge = CHALLENGE.replace('method="post"', 'method="get"')
        if (reason === 'external-action')
          f.controls.challenge = CHALLENGE.replace('action="/verified"', 'action="https://elsewhere.example/collect"')
        if (reason === 'embedded') f.controls.challenge = '<iframe src="/embedded"></iframe>'
        await f.signIn()
        if (reason === 'embedded') await f.page.frameLocator('iframe').locator('input[name=otp]').waitFor()
        const manual = await f.browser.callTool('browser_snapshot', {})
        await f.browser.callTool('sign_in', {})
        await f.browser.callTool('browser_snapshot', {})
        assert({
          given: reason,
          should: 'read no further secrets, submit no code, hide code controls, and explain the browser handoff',
          actual: [
            f.counts.reads,
            f.counts.codes,
            JSON.stringify(manual).includes('wait_for_person'),
            JSON.stringify(manual).includes('135790'),
          ],
          expected: [1, 0, true, false],
        })
      })
    }
  },
)

test(
  'verification cannot borrow an approval after navigation, source revocation, or a completed sign-in',
  { timeout: 60000 },
  async () => {
    for (const reason of ['no-login', 'navigated', 'disconnected', 'expired', 'completed'] as const) {
      await fixture(async (f) => {
        let clock = 0
        f.options.now = () => clock
        if (reason !== 'no-login') await f.signIn()
        if (reason === 'no-login' || reason === 'navigated')
          await f.browser.callTool('browser_navigate', { url: `${ORIGIN}/challenge` })
        if (reason === 'disconnected') f.options.sources = async () => []
        if (reason === 'expired') clock = 120_001
        if (reason === 'completed') {
          await f.page.goto(`${ORIGIN}/verified`)
          await f.browser.callTool('browser_snapshot', {})
          await f.page.goto(`${ORIGIN}/challenge`)
        }
        await f.browser.callTool('browser_snapshot', {})
        await f.browser.callTool('sign_in', {})
        assert({
          given: reason,
          should: 'not fetch or fill an authenticator code',
          actual: [f.counts.reads, f.counts.codes, await f.page.locator('input[name=otp]').inputValue()],
          expected: [reason === 'no-login' ? 0 : 1, 0, ''],
        })
      })
    }
  },
)

test('changed verification forms and login items are rechecked after the code read', { timeout: 60000 }, async () => {
  for (const reason of ['replacement', 'action', 'path', 'source', 'item', 'origin', 'field-purpose'] as const) {
    await fixture(async (f) => {
      await f.signIn()
      f.controls.onCodeRead = async () => {
        if (reason === 'replacement')
          await f.page.locator('main').evaluate((main) => {
            main.replaceChildren(...Array.from(main.childNodes, (node) => node.cloneNode(true)))
          })
        if (reason === 'action')
          await f.page.locator('form').evaluate((form) => {
            form.setAttribute('action', '/different')
          })
        if (reason === 'path') await f.page.evaluate(() => history.replaceState({}, '', '/different'))
        if (reason === 'source') f.options.sources = async () => []
        if (reason === 'field-purpose')
          await f.page.locator('input[name=otp]').evaluate((field) => {
            field.setAttribute('autocomplete', 'off')
          })
        if (reason === 'item') f.item.version++
        if (reason === 'origin')
          f.item.websites = [{ url: 'https://elsewhere.example', autofillBehavior: 'ExactDomain' }] as Item['websites']
      }
      const outcome = await f.browser.callTool('browser_snapshot', {})
      assert({
        given: reason,
        should: 'leave the code field untouched and return no sensitive value',
        actual: [
          f.counts.codes,
          await f.page.locator('input[name=otp]').inputValue(),
          JSON.stringify(outcome).includes(CODE),
        ],
        expected: [0, '', false],
      })
    })
  }
})

test('rejected verification codes are handed to the person without automatic retries', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    f.controls.reject = true
    await f.signIn()
    await f.browser.callTool('browser_snapshot', {})
    await f.page.waitForURL(`${ORIGIN}/verified`)
    const handoff = await f.browser.callTool('browser_snapshot', {})
    await f.browser.callTool('sign_in', {})
    await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'the site rejects the first submitted code',
      should: 'stop after one attempt and keep the second challenge private',
      actual: [f.counts, JSON.stringify(handoff).includes('wait_for_person')],
      expected: [{ approval: 1, reads: 2, passwords: 1, codes: 1 }, true],
    })
  }),
)

test('cancelling during a code read destroys the browser without filling the code', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.signIn()
    const abort = new AbortController()
    f.controls.onCodeRead = async () => {
      abort.abort()
      await f.browser.close()
    }
    const output = await f.browser.callTool('browser_snapshot', {}, { signal: abort.signal })
    assert({
      given: 'cancellation while a provider response is pending',
      should: 'close the browser, send no code, and serialize no provider data',
      actual: [f.page.isClosed(), f.counts.codes, JSON.stringify(output).includes(CODE), await readdir(f.dir)],
      expected: [true, 0, false, []],
    })
  }),
)
