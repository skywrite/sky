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
import { buildActionTable } from '../jev/table.ts'
import type { McpToolResult } from '../mcp/client.ts'
import { SignInBroker, type SignInBrokerOptions } from './broker.ts'
import { launchPrivateBrowser } from './launch.ts'
import { NativeApprovalError } from './nativeApproval.ts'
import type { NativeAuthenticationApproval } from './nativeAuthentication.ts'
import { readSignInResult } from './outcome.ts'
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
    const root = await mkdtemp(path.join(os.tmpdir(), 'sky-private-worker-test-'))
    const dir = path.join(root, 'files')
    const client = await launchPrivateBrowser({
      objective: 'Read the Atlas example site',
      filesDir: dir,
      profileDir: path.join(root, 'profile'),
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
          JSON.parse(
            blank.content
              .flatMap((entry) =>
                entry.type === 'text' && 'text' in entry && typeof entry.text === 'string' ? [entry.text] : [],
              )
              .join('\n'),
          ).reason,
          await readdir(dir),
        ],
        expected: [true, false, true, 'unsupported_page', []],
      })
      await client.callTool('sky_finish', {})
      const idle = await client.listTools()
      const next = path.join(root, 'next-files')
      await client.callTool('sky_start', { objective: 'Read the next example site', filesDir: next, headless: true })
      const restarted = await client.callTool('browser_snapshot', {})
      assert({
        given: 'another bounded task in the same private worker',
        should: 'start with a fresh task tab and download scope without exposing host lifecycle tools',
        actual: [
          idle,
          text(restarted).includes('about:blank'),
          await readdir(next),
          (await client.listTools()).some((tool) => tool.name.startsWith('sky_')),
        ],
        expected: [[], true, [], false],
      })
    } finally {
      await client.close()
      await rm(root, { recursive: true, force: true })
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
    nativeApproval: NativeAuthenticationApproval
  }) => Promise<void>,
  nativeChoice = false,
  actionTimeoutMs?: number,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-private-sign-in-test-'))
  const dir = path.join(root, 'files')
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
  const nativeApproval: NativeAuthenticationApproval = {
    method: async () => 'password',
    begin: async () => false,
    provider: async () => false,
    finish: async () => false,
  }
  const browser = await PrivateBrowserSession.launch({
    filesDir: dir,
    profileDir: path.join(root, 'profile'),
    headless: true,
    actionTimeoutMs,
    broker: new SignInBroker(options),
    ...(nativeChoice ? { nativeApproval, offerNativeChoice: true } : {}),
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
    await work({ browser, page, dir, counts, options, item, nativeApproval })
  } finally {
    await browser.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('sign-in inspection failures keep a fixed reason without exposing native errors', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    const frames = f.page.frames.bind(f.page)
    try {
      for (const [message, reason] of [
        [`Frame was detached: ${PASSWORD}`, 'page_changed'],
        [`Target page has been closed: ${PASSWORD}`, 'browser_unavailable'],
        [`Timeout preparing page: ${PASSWORD}`, 'browser_timeout'],
        [`Unexpected native error: ${PASSWORD}`, 'inspection_failed'],
      ]) {
        f.page.frames = () => {
          throw new Error(message)
        }
        const reply = await f.browser.callTool('sign_in', {})
        const outcome = readSignInResult((reply.content[0] as { text: string }).text)
        assert({
          given: `a ${reason} failure before a saved-login lookup`,
          should: 'return a parseable safe result that identifies the failed stage',
          actual: [outcome?.reason, outcome?.operation, text(reply).includes(PASSWORD), f.counts.lookup],
          expected: [reason, 'inspect', false, 0],
        })
      }
    } finally {
      f.page.frames = frames
    }
  }),
)

test(
  'choosing 1Password recaptures a replaced form before asking for lookup permission',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
      f.nativeApproval.method = async () => {
        // A reactive page can replace its form while the native method dialog is open.
        await f.page.evaluate(() => {
          const form = document.querySelector('form')!
          form.replaceWith(form.cloneNode(true))
        })
        return 'password'
      }
      const result = await f.browser.callTool('sign_in', {})
      const outcome = JSON.parse(
        result.content
          .flatMap((entry) =>
            entry.type === 'text' && 'text' in entry && typeof entry.text === 'string' ? [entry.text] : [],
          )
          .join('\n'),
      )
      assert({
        given: 'the user chose 1Password but the captured form was replaced',
        should: 'open lookup and selection for the current form and submit only after those approvals',
        actual: [outcome.status, f.counts, text(result).includes(PASSWORD)],
        expected: ['submitted', { lookup: 1, choose: 1, read: 1, submitted: 1 }, false],
      })
    }, true),
)

test('a website change during the method dialog cannot inherit the 1Password choice', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    f.nativeApproval.method = async () => {
      await f.page.goto('https://elsewhere.example/login')
      return 'password'
    }
    const result = await f.browser.callTool('sign_in', {})
    assert({
      given: 'the site changed while the person chose 1Password',
      should: 'stop with a visible reason before lookup, selection or filling',
      actual: [text(result).includes('page_changed'), f.counts],
      expected: [true, { lookup: 0, choose: 0, read: 0, submitted: 0 }],
    })
  }, true),
)

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

test('a failed native method dialog reports its error without accessing 1Password', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    f.nativeApproval.method = async () => {
      throw new NativeApprovalError()
    }
    const reply = await f.browser.callTool('sign_in', {})
    const signed = JSON.parse((reply.content[0] as { text: string }).text)
    assert({
      given: 'a crash after opening the method dialog',
      should: 'identify the failed dialog rather than report user cancellation or read a credential',
      actual: [signed.status, signed.reason, signed.message.includes('dialog failed'), f.counts],
      expected: ['unavailable', 'approval_unavailable', true, { lookup: 0, choose: 0, read: 0, submitted: 0 }],
    })
  }, true),
)

test('a sign-in redirect reaches the account on another HTTPS origin', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    await f.page.route('https://atlas.example/session', (route) =>
      route.fulfill({ status: 303, headers: { location: 'https://account.atlas.example/' } }),
    )
    await f.page.route('https://account.atlas.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Atlas account</title><h1>Signed in</h1>' }),
    )
    const signed = await f.browser.callTool('sign_in', {})
    await f.page.waitForURL('https://account.atlas.example/')
    const snapshot = await f.browser.callTool('browser_snapshot', {})
    const next = await f.browser.callTool('browser_navigate', { url: 'https://account.atlas.example/documents' })
    assert({
      given: 'an approved login redirects to the account subdomain',
      should: 'show the account and allow navigation there without another credential read',
      actual: [text(signed).includes('submitted'), text(snapshot).includes('Signed in'), next.isError, f.counts.read],
      expected: [true, true, false, 1],
    })
  }),
)

test('a blocked sign-in redirect identifies Sky as the blocker', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
    await f.page.route('https://atlas.example/session', (route) =>
      route.fulfill({ status: 307, headers: { location: 'https://elsewhere.example/receive' } }),
    )
    const signed = await f.browser.callTool('sign_in', {})
    const snapshot = await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'a redirect tries to replay a credential POST to another origin',
      should: 'report the blocked destination without blaming 1Password or asking for manual sign-in on an error page',
      actual: [
        text(signed).includes('blocked_navigation'),
        text(signed).includes('https://elsewhere.example'),
        text(snapshot).includes('Sky blocked'),
        text([signed, snapshot]).includes(PASSWORD),
        f.counts.submitted,
      ],
      expected: [true, true, true, false, 0],
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

test('the action table uses the real browser viewport for visible controls', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/documents' })
    await f.page.setViewportSize({ width: 1920, height: 1200 })
    await f.page.setContent(
      '<button style="position:absolute;left:1550px;top:1000px" onclick="this.textContent=\'Opened\'">Documents</button>',
    )
    const snapshot = await f.browser.callTool('browser_snapshot', { boxes: true })
    const content = snapshot.content
      .flatMap((part) => (part.type === 'text' && 'text' in part ? [part.text] : []))
      .join('\n')
    const table = buildActionTable(content)
    const control = table.rows.find((row) => row.name === 'Documents')
    const clicked = control ? await f.browser.callTool('browser_click', { target: control.ref }) : undefined
    assert({
      given: 'a visible document control beyond the default browser dimensions',
      should: 'include and activate it using the existing window size',
      actual: [table.rows.length, clicked?.isError, await f.page.locator('button').textContent()],
      expected: [1, false, 'Opened'],
    })
  }),
)

test('an unresponsive browser input ends its task page before recovery', { timeout: 30000 }, async () =>
  fixture(
    async (f) => {
      await f.browser.callTool('browser_navigate', { url: 'https://atlas.example/login' })
      await f.page.locator('input[type=password]').evaluate((field) => field.remove())
      await f.page.locator('input').evaluate((field) => field.removeAttribute('autocomplete'))
      f.page.mouse.wheel = () => new Promise<void>((resolve) => f.page.once('close', () => resolve()))
      const response = await f.browser.callTool('browser_mouse_wheel', { deltaX: 0, deltaY: 500 })
      await f.browser.close()
      assert({
        given: 'Chromium never acknowledges a wheel event',
        should: 'return a bounded timeout and close the old page so a delayed input cannot race a recovered task',
        actual: [
          (response.structuredContent as { kind: string }).kind,
          response.isError,
          f.page.isClosed(),
          f.browser.recoveryUrl(),
        ],
        expected: ['browser_timeout', true, true, 'https://atlas.example/login'],
      })
    },
    false,
    500,
  ),
)
