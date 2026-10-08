import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Item } from '@1password/sdk'
import { chromium, type Page } from 'playwright'
import type { McpTextContent, McpToolResult } from '#lib/browser/mcp/client.ts'
import { SignInBroker, type SignInBrokerOptions } from '#lib/browser/signIn/broker.ts'
import { launchPrivateBrowser } from '#lib/browser/signIn/launch.ts'
import { NATIVE_BROWSER } from '#lib/browser/signIn/nativeBrowser.ts'
import { PrivateBrowserSession } from '#lib/browser/signIn/session.ts'
import { runBrowserTask } from '#lib/browser/task/runTask.ts'
import {
  OnePasswordCredentialProvider,
  type OnePasswordClient,
} from '#lib/credentials/providers/OnePasswordCredentialProvider.ts'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { exists } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { scriptedBrowserModel } from '#test/browserTask.ts'
import { ProfileEvidence } from './evidence.ts'
import importLinkedIn from './worker.ts'

const PROFILE = 'https://www.linkedin.com/in/jane-doe-example/'
const USERNAME = 'jane@example.com'
const PASSWORD = 'mock-Atlas-password-497!'
const CODE = '123456'
const LOGIN = `<main><h1>Sign in</h1><div><label>Email<input id="email" type="email" autocomplete="username webauthn"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><button type="button">Sign in</button></div></main><script>
document.querySelector('button').onclick = async () => {
  await fetch('/session', { method: 'POST', body: new URLSearchParams({ email: document.querySelector('#email').value, password: document.querySelector('#password').value }) });
  location.assign('/checkpoint/challenge');
};
</script>`
const CHALLENGE =
  '<main><h1>Verification</h1><form method="post" action="/verify"><label>Code<input name="code" autocomplete="one-time-code"></label><button>Verify</button></form></main>'
const PROFILE_HTML = `<title>Jane Doe | LinkedIn</title><main><h1>Jane Doe</h1><section><h2>About</h2><p>Research lead</p><p>${USERNAME} ${PASSWORD}</p></section><section><h2>Experience</h2><a href="/company/atlas-example/">Atlas</a><p>Atlas · Research lead · 2022 – Present</p></section><aside>Private sidebar</aside><form><textarea>Private authentication controls</textarea></form></main>`
const text = (reply: McpToolResult) =>
  reply.content
    .flatMap((part) => (part.type === 'text' && 'text' in part ? [(part as McpTextContent).text] : []))
    .join('\n')

async function fixture(
  work: (f: {
    browser: PrivateBrowserSession
    page: Page
    dir: string
    counts: { lookup: number; choose: number; read: number; submitted: number }
    options: SignInBrokerOptions
    item: Item
    manuallySignIn: () => Promise<void>
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-browser-test-'))
  const counts = { lookup: 0, choose: 0, read: 0, submitted: 0 }
  let signedIn = false
  const item = {
    id: 'login',
    vaultId: 'example-vault',
    category: 'Login',
    title: 'LinkedIn example',
    version: 1,
    tags: [],
    sections: [],
    websites: [{ url: 'https://www.linkedin.com', autofillBehavior: 'ExactDomain' }],
    fields: [
      { id: 'username', title: 'Username', fieldType: 'Text', value: USERNAME },
      { id: 'password', title: 'Password', fieldType: 'Concealed', value: PASSWORD },
    ],
  } as unknown as Item
  const provider = new OnePasswordCredentialProvider(
    {
      vaults: { list: async () => [{ id: 'example-vault', title: 'Example vault' }] },
      items: {
        list: async () => [{ ...item, state: 'active' }],
        get: async () => {
          counts.read++
          return structuredClone(item)
        },
      },
    } as unknown as OnePasswordClient,
    { id: 'example' },
  )
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
    filesDir: path.join(dir, 'files'),
    profileDir: path.join(dir, 'profile'),
    headless: true,
    broker: new SignInBroker(options),
    prepare: async (created) => {
      page = created
      await page.context().route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (request.method() === 'POST' && url.pathname === '/session') {
          const fields = new URLSearchParams(request.postData() ?? '')
          if (fields.get('email') === USERNAME && fields.get('password') === PASSWORD) counts.submitted++
          await route.fulfill({ contentType: 'text/plain', body: 'Verification required' })
        } else if (url.pathname === '/verify' && request.method() === 'POST') {
          signedIn = new URLSearchParams(request.postData() ?? '').get('code') === CODE
          await route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/feed/")</script>' })
        } else if (url.pathname.startsWith('/in/')) {
          await route.fulfill({
            contentType: 'text/html',
            body: signedIn ? PROFILE_HTML : '<script>location.replace("/authwall")</script>',
          })
        } else
          await route.fulfill({
            contentType: 'text/html',
            body:
              url.pathname === '/login'
                ? LOGIN
                : url.pathname === '/checkpoint/challenge'
                  ? CHALLENGE
                  : '<main>Continue in LinkedIn</main>',
          })
      })
    },
  })
  try {
    await work({
      browser,
      page,
      dir,
      counts,
      options,
      item,
      manuallySignIn: async () => {
        signedIn = true
        await page.goto(PROFILE)
      },
    })
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test(
  'the shared browser completes a saved LinkedIn authenticator challenge and scrubs evidence',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      f.item.fields.push({
        id: 'otp',
        title: 'Authenticator',
        fieldType: 'Totp',
        value: 'mock-seed',
        details: { type: 'Otp', content: { code: CODE } },
      } as Item['fields'][number])
      await f.browser.callTool('browser_navigate', { url: 'https://www.linkedin.com/login' })
      const signed = await f.browser.callTool('sign_in', {})
      await f.page.waitForURL('**/checkpoint/challenge')
      const verified = await f.browser.callTool('browser_snapshot', {})
      await f.page.waitForURL('**/feed/')
      await f.browser.callTool('browser_navigate', { url: PROFILE })
      const captured = await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE })
      const profile = ProfileEvidence.parse(JSON.parse(text(captured)))
      assert({
        given: 'a LinkedIn password login with a saved authenticator',
        should: 'use the shared sign-in flow and export only scrubbed main-page evidence',
        actual: [
          JSON.parse(text(signed)).status,
          f.counts,
          [USERNAME, PASSWORD, CODE, 'mock-seed', 'Private sidebar', 'Private authentication controls'].some((value) =>
            JSON.stringify([signed, verified, captured]).includes(value),
          ),
          profile.name,
          profile.companies[0]?.name,
          await readdir(path.join(f.dir, 'files')),
        ],
        expected: ['submitted', { lookup: 1, choose: 1, read: 2, submitted: 1 }, false, 'Jane Doe', 'Atlas', []],
      })
    })
  },
)

test(
  'Person import runs the shared browser task, resumes manual verification and closes before extraction',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      const input = {
        url: PROFILE,
        progressFile: path.join(f.dir, 'progress.json'),
        cancelFile: path.join(f.dir, 'cancel.json'),
      }
      const replies: McpToolResult[] = []
      let resumed = false
      let closedBeforeExtraction = false
      let extractionSafe = false
      const result = await importLinkedIn(input, {
        model: scriptedBrowserModel([
          { name: 'browser_navigate', input: { url: 'https://www.linkedin.com/login' } },
          { name: 'sign_in' },
          { name: 'browser_snapshot' },
          { name: 'wait_for_person', input: { message: 'Finish verification in the browser.' } },
          { name: 'browser_navigate', input: { url: PROFILE } },
          { name: 'capture_profile' },
        ]),
        runTask: (options) =>
          runBrowserTask({
            ...options,
            browser: {
              listTools: () => f.browser.listTools(),
              close: () => f.browser.close(),
              callTool: async (name, args, callOptions) => {
                const reply = await f.browser.callTool(name, args, callOptions)
                replies.push(reply)
                if (name === 'sign_in') await f.page.waitForURL('**/checkpoint/challenge')
                if (
                  name === 'browser_snapshot' &&
                  (await readJson<{ phase: string }>(input.progressFile))?.phase === 'needs_user' &&
                  !resumed
                ) {
                  resumed = true
                  await f.page.getByLabel('Code').fill(CODE)
                  await f.page.getByRole('button', { name: 'Verify' }).click()
                  await f.page.waitForURL('**/feed/')
                }
                return reply
              },
            },
          }),
        extract: async (source) => {
          closedBeforeExtraction = f.page.isClosed()
          extractionSafe =
            ![USERNAME, PASSWORD, CODE, 'Private sidebar', 'Private authentication controls'].some((value) =>
              JSON.stringify(source).includes(value),
            ) &&
            source.text.includes('Research lead') &&
            source.companies[0]?.name === 'Atlas'
          return {
            url: source.url,
            name: source.name,
            title: 'Research lead',
            location: '',
            about: '',
            current: [],
            past: [],
          }
        },
      })
      assert({
        given: 'a profile behind a login and a separate verification challenge',
        should: 'resume automatically after the person verifies, capture the selected page and close before extraction',
        actual: [
          f.counts,
          resumed,
          result.name,
          closedBeforeExtraction,
          extractionSafe,
          [USERNAME, PASSWORD, CODE].some((value) =>
            (JSON.stringify(replies) + JSON.stringify(result) + '').includes(value),
          ),
          (await readFile(input.progressFile, 'utf8')).includes('Preparing'),
        ],
        expected: [{ lookup: 1, choose: 1, read: 1, submitted: 1 }, true, 'Jane Doe', true, true, false, true],
      })
    })
  },
)

test(
  'profile capture rejects changed profiles, authentication pages and model-supplied overrides',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      const replies: McpToolResult[] = []
      await f.browser.callTool('browser_navigate', { url: 'https://www.linkedin.com/login' })
      const hidden = await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE })
      await f.manuallySignIn()
      replies.push(await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE, approved: true }))
      replies.push(await f.browser.callTool('sky_read_linkedin_profile', { url: 'https://evil.example' }))
      await f.page.goto('https://www.linkedin.com/in/someone-else-example/')
      replies.push(await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE }))
      const tools = await f.browser.listTools()
      assert({
        given: 'credential entry, another profile and attempts to override the host operation',
        should: 'withhold evidence and expose only ordinary browser controls to the model',
        actual: [
          (hidden.structuredContent as { kind: string }).kind,
          text(hidden).includes(USERNAME),
          replies.every((reply) => reply.isError),
          tools.some((tool) => tool.name === 'browser_navigate'),
          tools.some((tool) => tool.name.startsWith('sky_')),
          f.counts.read,
        ],
        expected: ['authentication_required', false, true, true, false, 0],
      })
    })
  },
)

test('cancelling Person import interrupts native sign-in and closes its task', { timeout: 30000 }, async () => {
  await fixture(async (f) => {
    const input = {
      url: PROFILE,
      progressFile: path.join(f.dir, 'progress.json'),
      cancelFile: path.join(f.dir, 'cancel.json'),
    }
    f.options.approval.allowLookup = async () => {
      await writeJson(input.cancelFile, { cancelled: true })
      return new Promise((resolve) => f.page.once('close', () => resolve(false)))
    }
    let extracted = false
    let message = ''
    try {
      await importLinkedIn(input, {
        model: scriptedBrowserModel([
          { name: 'browser_navigate', input: { url: 'https://www.linkedin.com/login' } },
          { name: 'sign_in' },
        ]),
        runTask: (options) => runBrowserTask({ ...options, browser: f.browser }),
        extract: async () => {
          extracted = true
          throw new Error('Unexpected extraction')
        },
      })
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'cancellation during sign-in approval',
      should: 'close the task without reading credentials or extracting a draft',
      actual: [message, f.page.isClosed(), f.counts.read, extracted],
      expected: ['Import cancelled.', true, 0, false],
    })
  })
})

test(
  'the real browser worker offers shared task controls and keeps profile capture host-only',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-worker-test-'))
    const browser = await launchPrivateBrowser({
      objective: 'Import an example profile',
      filesDir: path.join(dir, 'files'),
      profileDir: path.join(dir, 'profile'),
      headless: true,
    })
    try {
      const names = (await browser.listTools()).map((tool) => tool.name)
      const captured = await browser.callTool('sky_read_linkedin_profile', { url: PROFILE })
      assert({
        given: 'the shared worker before opening a profile',
        should: 'offer browser-task navigation and sign-in without exposing capture or the removed LinkedIn script',
        actual: [
          names.includes('browser_navigate'),
          names.includes('sign_in'),
          names.some((name) => name.startsWith('sky_') || name === 'linkedin_step'),
          captured.isError,
        ],
        expected: [true, true, false, true],
      })
    } finally {
      await browser.close()
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test('LinkedIn login approval cannot survive changed controls or a changed path', { timeout: 30000 }, async () => {
  for (const change of ['controls', 'path'])
    await fixture(async (f) => {
      await f.browser.callTool('browser_navigate', { url: 'https://www.linkedin.com/login' })
      f.options.approval.choose = async () => {
        if (change === 'controls')
          await f.page.locator('main').evaluate((main) => main.replaceWith(main.cloneNode(true)))
        else await f.page.evaluate(() => history.replaceState(null, '', '/feed/'))
        return 0
      }
      const signed = await f.browser.callTool('sign_in', {})
      assert({
        given: `the ${change} changed during approval`,
        should: 'reject the changed form before reading or submitting a credential',
        actual: [JSON.parse(text(signed)).reason, f.counts.lookup, f.counts.read, f.counts.submitted],
        expected: ['page_changed', 1, 0, 0],
      })
    })
})

test(
  'profile capture recognizes a name outside h1 and fails promptly on unreadable content',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      await f.manuallySignIn()
      await f.page.setContent(
        '<title>(3) Jane Doe | LinkedIn</title><div role="main"><p>Jane Doe</p><p>Research lead</p><section><h2>About</h2><p>Works on accessible design.</p></section><input name="pinnedSearch" value=""></div>',
      )
      const captured = await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE })
      await f.page.setContent('<title>LinkedIn</title><main><p>Profile is loading</p></main>')
      const unreadable = await f.browser.callTool('sky_read_linkedin_profile', { url: PROFILE })
      assert({
        given: 'a changed LinkedIn layout followed by content that is still loading',
        should: 'capture a visible profile name and explain when the browser task needs to wait or retry',
        actual: [
          ProfileEvidence.parse(JSON.parse(text(captured))).name,
          unreadable.isError,
          text(unreadable).includes('not readable'),
          f.counts.lookup,
        ],
        expected: ['Jane Doe', true, true, 0],
      })
    })
  },
)

test(
  'Person import reuses an existing Brave login and closes only its own task tab',
  { ignore: !(await exists(NATIVE_BROWSER.executablePath)), timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-brave-test-'))
    const context = await chromium.launchPersistentContext(path.join(root, 'brave-profile'), {
      executablePath: NATIVE_BROWSER.executablePath,
      headless: true,
    })
    let lookups = 0
    try {
      await context.addCookies([{ name: 'session', value: 'synthetic-session', url: 'https://www.linkedin.com' }])
      await context.route('**/*', async (route) => {
        await route.fulfill({
          contentType: 'text/html',
          body: route.request().headers().cookie?.includes('session=synthetic-session') ? PROFILE_HTML : LOGIN,
        })
      })
      const existingPage = context.pages()[0]!
      await existingPage.goto(PROFILE)
      const taskPage = await context.newPage()
      const browser = await PrivateBrowserSession.launch({
        profileDir: path.join(root, 'unused-profile'),
        filesDir: path.join(root, 'files'),
        attached: {
          context,
          page: taskPage,
          protocol: (page) => context.newCDPSession(page),
          close: () => taskPage.close(),
        },
        broker: new SignInBroker({
          sources: async () => {
            lookups++
            return []
          },
          connect: async () => {
            throw new Error('No credential lookup expected')
          },
          approval: { allowLookup: async () => false, choose: async () => null },
        }),
      })
      const result = await importLinkedIn(
        { url: PROFILE, cancelFile: path.join(root, 'cancel.json'), progressFile: path.join(root, 'progress.json') },
        {
          model: scriptedBrowserModel([
            { name: 'browser_navigate', input: { url: PROFILE } },
            { name: 'browser_snapshot' },
            { name: 'capture_profile' },
          ]),
          runTask: (options) => runBrowserTask({ ...options, browser }),
          extract: async (source) => ({
            url: source.url,
            name: source.name,
            title: '',
            location: '',
            about: '',
            current: [],
            past: [],
          }),
        },
      )
      assert({
        given: 'an already signed-in Brave profile with an existing tab',
        should: 'reuse its login without credential lookup and preserve the browser, original tab and cookies',
        actual: [
          result.name,
          lookups,
          taskPage.isClosed(),
          existingPage.isClosed(),
          existingPage.url(),
          (await context.cookies('https://www.linkedin.com')).some((cookie) => cookie.value === 'synthetic-session'),
        ],
        expected: ['Jane Doe', 0, true, false, PROFILE, true],
      })
    } finally {
      await context.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
