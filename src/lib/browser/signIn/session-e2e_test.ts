import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Item } from '@1password/sdk'
import type { Page } from 'playwright'
import {
  OnePasswordCredentialProvider,
  type OnePasswordClient,
} from '#lib/credentials/providers/OnePasswordCredentialProvider.ts'
import { assert, test } from '#test'
import type { McpToolResult } from '../mcp/client.ts'
import { SignInBroker, type SignInBrokerOptions } from './broker.ts'
import { launchPrivateBrowser } from './launch.ts'
import { PrivateBrowserSession } from './session.ts'

const PASSWORD = 'mock-Atlas-password-497!'
const USERNAME = 'jane@example.com'
const FORM =
  '<form method="post" action="/session"><label>Email<input name="email" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>'
const text = (value: unknown) => JSON.stringify(value)

test(
  'the worker has only task tools, no approval or credential RPC, and closes its session',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-private-worker-test-'))
    const client = await launchPrivateBrowser({
      objective: 'Read the Atlas example site',
      filesDir: dir,
      headless: true,
    })
    try {
      const names = (await client.listTools()).map((tool) => tool.name)
      const forbidden: McpToolResult[] = []
      for (const name of [
        'approve',
        'readFields',
        'getOtp',
        'browser_evaluate',
        'browser_run_code',
        'browser_take_screenshot',
        'browser_tabs',
        'sky_start',
      ]) {
        forbidden.push(await client.callTool(name, {}))
      }
      const blank = await client.callTool('sign_in', {})
      assert({
        given: 'the real private worker on a blank browser',
        should: 'expose sign-in intent only, reject bypass operations, and require a concrete supported form',
        actual: [
          names.includes('sign_in'),
          names.includes('approve'),
          forbidden.every((reply) => reply.isError),
          blank,
          await readdir(dir),
        ],
        expected: [
          true,
          false,
          true,
          {
            content: [{ type: 'text', text: '{"status":"needs_user"}' }],
            isError: false,
            structuredContent: undefined,
          },
          [],
        ],
      })
    } finally {
      await client.close()
      await rm(dir, { recursive: true, force: true })
    }
  },
)

async function fixture(
  work: (f: {
    browser: PrivateBrowserSession
    page: Page
    dir: string
    counts: { lookup: number; choose: number; read: number; submitted: number }
    options: SignInBrokerOptions
    item: Item
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-private-sign-in-test-'))
  const counts = { lookup: 0, choose: 0, read: 0, submitted: 0 }
  const item = {
    id: 'login',
    vaultId: 'example-vault',
    category: 'Login',
    title: 'Atlas',
    version: 1,
    tags: [],
    sections: [],
    websites: [{ url: 'https://atlas.example', autofillBehavior: 'ExactDomain' }],
    fields: [
      { id: 'username', title: 'Username', fieldType: 'Text', value: USERNAME },
      { id: 'password', title: 'Password', fieldType: 'Concealed', value: PASSWORD },
    ],
  } as unknown as Item
  const client = {
    vaults: { list: async () => [{ id: 'example-vault', title: 'Example vault' }] },
    items: {
      list: async () => [{ ...item, state: 'active' }],
      get: async () => {
        counts.read++
        return structuredClone(item)
      },
    },
  } as unknown as OnePasswordClient
  const provider = new OnePasswordCredentialProvider(client, { id: 'example' })
  const options: SignInBrokerOptions = {
    sources: async () => [
      { id: 'example', account: 'example-account', label: 'Example account', excludedVaultIds: [] },
    ],
    connect: async () => provider,
    approval: {
      allowLookup: async () => {
        counts.lookup++
        return true
      },
      choose: async () => {
        counts.choose++
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
        if (request.method() === 'POST') {
          const fields = new URLSearchParams(request.postData() ?? '')
          if (fields.get('email') === USERNAME && fields.get('password') === PASSWORD) counts.submitted++
          await route.fulfill({
            contentType: 'text/html',
            body: `<h1>Atlas account</h1><p>Signed in</p><p>${PASSWORD}</p><a href="data:text/plain,Atlas%20synthetic%20statement" download="statement.txt">Download statement</a><a href="data:text/plain,${encodeURIComponent(PASSWORD)}" download="withheld.txt">Download echo</a><script>console.error(${JSON.stringify(PASSWORD)})</script>`,
          })
        } else await route.fulfill({ contentType: 'text/html', body: `<title>Atlas sign-in</title>${FORM}` })
      })
    },
  })
  try {
    await work({ browser, page, dir, counts, options, item })
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test('private browser signs in with 1Password and exposes only redacted page outcomes', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    const before = await f.browser.callTool('browser_snapshot', { boxes: true })
    const login = await f.browser.callTool('sign_in', {})
    await f.page.waitForURL('https://atlas.example/session')
    const after = await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'a native-approved login on an exact HTTPS origin',
      should: 'submit directly, show the signed-in page, and never serialize either field',
      actual: [
        f.counts,
        login.isError,
        text(login).includes('submitted'),
        text(after).includes('Signed in'),
        text([before, login, after]).includes(PASSWORD),
        text([before, login, after]).includes(USERNAME),
      ],
      expected: [{ lookup: 1, choose: 1, read: 1, submitted: 1 }, false, true, true, false, false],
    })
    const denied = await Promise.all([
      f.browser.callTool('browser_evaluate', { expression: 'document.body.innerText' }),
      f.browser.callTool('browser_take_screenshot', { filename: 'leak.png' }),
      f.browser.callTool('browser_snapshot', { filename: 'leak.txt' }),
      f.browser.callTool('browser_tabs', { action: 'list' }),
      f.browser.callTool('readFields', {}),
      f.browser.callTool('sign_in', { origin: 'https://evil.example', approved: true }),
      f.browser.callTool('browser_navigate', { url: 'https://evil.example' }),
    ])
    assert({
      given: 'attempts to read raw DOM, screenshots, files, tabs, credentials or forge approval',
      should: 'reject every unsupported operation without creating artifacts',
      actual: [denied.every((reply) => reply.isError), await readdir(f.dir)],
      expected: [true, []],
    })
    const content = (await f.browser.callTool('browser_snapshot', {})).content[0] as { text: string }
    const downloadRef = content.text.match(/link "Download statement" \[ref=([^\]]+)\]/)?.[1]
    if (!downloadRef) throw new Error(`Download reference missing: ${content.text}`)
    const download = f.page.waitForEvent('download', { timeout: 5000 })
    const clicked = await f.browser.callTool('browser_click', { target: downloadRef })
    if (clicked.isError) throw new Error(`Click ${downloadRef}: ${text(clicked)}`)
    await download // the worker disposes the native download once it has checked and saved it
    await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'a task-owned download after sign-in',
      should: 'save the document without provider logs or snapshots',
      actual: [(await readdir(f.dir)).sort(), await readFile(path.join(f.dir, 'statement.txt'), 'utf8')],
      expected: [['statement.txt'], 'Atlas synthetic statement'],
    })
    const latest = (await f.browser.callTool('browser_snapshot', {})).content[0] as { text: string }
    const echoRef = latest.text.match(/link "Download echo" \[ref=([^\]]+)\]/)?.[1]
    if (!echoRef) throw new Error('Echo reference missing')
    const echo = f.page.waitForEvent('download', { timeout: 5000 })
    await f.browser.callTool('browser_click', { target: echoRef })
    await echo
    await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'a destination echoing login data into a downloaded file',
      should: 'withhold the file from the task and model',
      actual: (await readdir(f.dir)).sort(),
      expected: ['statement.txt'],
    })
  }),
)

test('changed pages, forms and provider URLs invalidate native approval before fill', { timeout: 60000 }, async () => {
  for (const change of ['form-action', 'replacement', 'provider-site', 'excluded', 'cancel'] as const)
    await fixture(async (f) => {
      await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
      f.options.approval.choose = async () => {
        if (change === 'form-action')
          await f.page.locator('form').evaluate((form) => {
            form.setAttribute('action', 'https://evil.example/collect')
          })
        if (change === 'replacement')
          await f.page.locator('body').evaluate((body) => {
            body.replaceChildren(...Array.from(body.childNodes, (node) => node.cloneNode(true)))
          })
        if (change === 'provider-site')
          f.item.websites = [{ url: 'https://evil.example', autofillBehavior: 'ExactDomain' }] as Item['websites']
        if (change === 'excluded') f.options.sources = async () => []
        return change === 'cancel' ? null : 0
      }
      const result = await f.browser.callTool('sign_in', {})
      assert({
        given: change,
        should: 'never fill or submit and never return a provider value',
        actual: [
          f.counts.submitted,
          text(result).includes(PASSWORD),
          await f.page.locator('input[type=password]').inputValue(),
        ],
        expected: [0, false, ''],
      })
    })
})

test('wrong origins and GET forms cannot read credentials; no approval replay', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://evil.example/login' })
    await f.browser.callTool('sign_in', {})
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    await f.page.locator('form').evaluate((form) => {
      form.setAttribute('method', 'get')
    })
    await f.browser.callTool('sign_in', {})
    assert({
      given: 'a phishing origin and a same-origin GET form',
      should: 'never read a credential',
      actual: f.counts.read,
      expected: 0,
    })
    await f.page.locator('form').evaluate((form) => {
      form.setAttribute('method', 'post')
    })
    f.options.approval.choose = async () => null
    await f.browser.callTool('sign_in', {})
    const counts = { ...f.counts }
    await f.browser.callTool('sign_in', {})
    assert({
      given: 'a second model request after cancellation',
      should: 'not display another dialog or read a login',
      actual: [f.counts, f.counts.read],
      expected: [counts, 0],
    })
  }),
)
