import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Item } from '@1password/sdk'
import type { Page } from 'playwright'
import type { McpTextContent, McpToolResult } from '#lib/browser/mcp/client.ts'
import { SignInBroker, type SignInBrokerOptions } from '#lib/browser/signIn/broker.ts'
import { launchPrivateBrowser } from '#lib/browser/signIn/launch.ts'
import { PrivateBrowserSession } from '#lib/browser/signIn/session.ts'
import {
  OnePasswordCredentialProvider,
  type OnePasswordClient,
} from '#lib/credentials/providers/OnePasswordCredentialProvider.ts'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { assert, test } from '#test'
import { LinkedInBrowserResult } from './browser.ts'
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

async function fixture(
  work: (f: {
    browser: PrivateBrowserSession
    page: Page
    dir: string
    counts: { lookup: number; choose: number; read: number; submitted: number }
    options: SignInBrokerOptions
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
    linkedInProfile: PROFILE,
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
          if (!signedIn)
            await route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/authwall")</script>' })
          else
            await route.fulfill({
              contentType: 'text/html',
              body: `<main><h1>Jane Doe</h1><section><h2>About</h2><p>Research lead</p><p>${USERNAME} ${PASSWORD}</p></section><section><h2>Experience</h2><a href="/company/atlas-example/">Atlas</a><p>Atlas · Research lead · 2022 – Present</p></section><aside>Private sidebar</aside><form><textarea>Private authentication controls</textarea></form></main>`,
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
      manuallySignIn: async () => {
        signedIn = true
        await page.goto('https://www.linkedin.com/feed/')
      },
    })
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
}

async function step(browser: PrivateBrowserSession) {
  const reply = await browser.callTool('linkedin_step', {})
  if (reply.isError) throw new Error('Import step failed')
  return LinkedInBrowserResult.parse(JSON.parse((reply.content[0] as McpTextContent).text))
}

test(
  'Person import uses protected sign-in, hands off verification, and closes before extraction',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      const outcomes: unknown[] = []
      const stages: string[] = []
      const input = {
        url: PROFILE,
        progressFile: path.join(f.dir, 'progress.json'),
        cancelFile: path.join(f.dir, 'cancel.json'),
      }
      let closedBeforeExtraction = false
      let extractionSafe = false
      const draft = await importLinkedIn(input, {
        launch: async (options) => {
          if (options.linkedInProfile !== PROFILE) throw new Error('Import must use the restricted worker')
          return {
            close: () => f.browser.close(),
            callTool: async (name, args, options) => {
              stages.push((await readJson<{ stage: string }>(input.progressFile))?.stage ?? '')
              const reply = await f.browser.callTool(name, args, options)
              outcomes.push(reply)
              if (JSON.stringify(reply).includes('needs_user') && f.page.url().includes('/checkpoint/')) {
                await f.page.getByLabel('Code').fill(CODE)
                await f.page.getByRole('button', { name: 'Verify' }).click()
              }
              return reply
            },
          }
        },
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
      const serialized = JSON.stringify(outcomes) + (await readFile(input.progressFile, 'utf8'))
      assert({
        given: 'a profile behind a password login and a separate verification challenge',
        should: 'approve and fill once, hand off the code, isolate the session, and return only a safe draft',
        actual: [
          f.counts,
          draft.name,
          closedBeforeExtraction,
          extractionSafe,
          [USERNAME, PASSWORD, CODE].some((value) => serialized.includes(value)),
          stages.some((stage) => stage.includes('Approve')),
          stages.some((stage) => stage.includes('verification')),
          await readdir(path.join(f.dir, 'files')),
        ],
        expected: [{ lookup: 1, choose: 1, read: 1, submitted: 1 }, 'Jane Doe', true, true, false, true, true, []],
      })
    })
  },
)

test(
  'declining approval or having no password manager keeps manual sign-in available without repeated prompts',
  { timeout: 30000 },
  async () => {
    for (const configured of [true, false])
      await fixture(async (f) => {
        if (!configured) f.options.sources = async () => []
        f.options.approval.allowLookup = async () => {
          f.counts.lookup++
          return false
        }
        let outcome = await step(f.browser)
        for (let i = 0; i < 8 && outcome.status !== 'needs_user'; i++) outcome = await step(f.browser)
        await step(f.browser)
        await step(f.browser)
        await f.manuallySignIn()
        for (let i = 0; i < 8 && outcome.status !== 'ready'; i++) outcome = await step(f.browser)
        assert({
          given: configured ? 'a declined native prompt' : 'an unconfigured password manager',
          should: 'continue after manual login without reading a credential or repeating approval',
          actual: [outcome.status, f.counts],
          expected: ['ready', { lookup: configured ? 1 : 0, choose: 0, read: 0, submitted: 0 }],
        })
      })
  },
)

test('cancelling Person import interrupts native approval and destroys the browser', { timeout: 30000 }, async () => {
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
    let error = ''
    try {
      await importLinkedIn(input, {
        launch: async () => f.browser,
        extract: async () => {
          extracted = true
          throw new Error('Unexpected extraction')
        },
      })
    } catch (failure) {
      error = (failure as Error).message
    }
    assert({
      given: 'cancellation while the approval dialog is waiting',
      should: 'close the browser immediately without reading credentials or extracting a draft',
      actual: [error, f.page.isClosed(), f.counts.read, extracted],
      expected: ['Import cancelled.', true, 0, false],
    })
  })
})

test('a LinkedIn import cannot become a general browser or read another profile', { timeout: 30000 }, async () => {
  await fixture(async (f) => {
    const replies: McpToolResult[] = []
    for (const name of ['browser_snapshot', 'browser_navigate', 'browser_evaluate', 'sign_in', 'approve'])
      replies.push(await f.browser.callTool(name, {}))
    replies.push(await f.browser.callTool('linkedin_step', { url: 'https://evil.example', approved: true }))
    await step(f.browser)
    await f.manuallySignIn()
    await step(f.browser)
    await step(f.browser)
    await f.page.goto('https://www.linkedin.com/in/someone-else-example/')
    const changed = await f.browser.callTool('linkedin_step', {})
    let escaped = false
    await f.page.goto('https://evil.example').then(
      () => {
        escaped = true
      },
      () => {},
    )
    assert({
      given: 'arbitrary browser requests, a changed profile, and cross-origin navigation',
      should: 'refuse all three without exporting page content',
      actual: [replies.every((reply) => reply.isError), changed.isError, escaped, f.counts.read],
      expected: [true, true, false, 0],
    })
  })
})

test('the real private worker exposes only the pinned LinkedIn import operation', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-worker-test-'))
  const browser = await launchPrivateBrowser({
    objective: 'Import an example profile',
    linkedInProfile: PROFILE,
    filesDir: dir,
    headless: true,
  })
  try {
    const denied = await browser.callTool('browser_navigate', { url: 'https://www.linkedin.com/feed/' })
    assert({
      given: 'a worker started for one LinkedIn profile',
      should: 'expose progress only and reject general browser control',
      actual: [(await browser.listTools()).map((tool) => tool.name), denied.isError],
      expected: [['linkedin_step'], true],
    })
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test(
  'LinkedIn JavaScript login approval cannot survive changed controls or a changed path',
  { timeout: 30000 },
  async () => {
    for (const change of ['controls', 'path'])
      await fixture(async (f) => {
        f.options.approval.choose = async () => {
          if (change === 'controls')
            await f.page.locator('main').evaluate((main) => main.replaceWith(main.cloneNode(true)))
          else await f.page.evaluate(() => history.replaceState(null, '', '/feed/'))
          return 0
        }
        let outcome = await step(f.browser)
        for (let i = 0; i < 8 && outcome.status !== 'signing_in'; i++) outcome = await step(f.browser)
        outcome = await step(f.browser)
        assert({
          given: `the ${change} changed during native approval`,
          should: 'require the person without reading or filling the selected login',
          actual: [outcome.status, f.counts.lookup, f.counts.read, f.counts.submitted],
          expected: ['needs_user', 1, 0, 0],
        })
      })
  },
)

test(
  'a loaded profile with a name outside h1 proceeds to extraction instead of waiting for sign-in',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      await step(f.browser)
      await f.manuallySignIn()
      await step(f.browser)
      await f.page.setContent(
        '<title>(3) Jane Doe | LinkedIn</title><div role="main"><p>Jane Doe</p><p>Research lead</p><section><h2>About</h2><p>Works on accessible design.</p></section><input name="pinnedSearch" value=""></div>',
      )
      const ready = await step(f.browser)
      const read = await step(f.browser)
      assert({
        given: 'a profile name rendered as text in a main landmark, with an ordinary input whose name contains pin',
        should: 'recognize the selected profile and read it without another sign-in handoff',
        actual: [ready.status, read.status, read.status === 'ready' ? read.profile.name : '', f.counts.read],
        expected: ['reading', 'ready', 'Jane Doe', 0],
      })
    })
  },
)

test(
  'an unreadable selected profile has a short, specific timeout instead of waiting for verification',
  { timeout: 30000 },
  async () => {
    await fixture(async (f) => {
      await step(f.browser)
      await f.manuallySignIn()
      await step(f.browser)
      await f.page.setContent('<title>LinkedIn</title><main><p>Profile is loading</p></main>')
      const first = await step(f.browser)
      await new Promise((resolve) => setTimeout(resolve, 20_100))
      const last = await step(f.browser)
      assert({
        given: 'a selected profile whose content never becomes readable',
        should: 'report profile loading and then a specific failure within 21 seconds',
        actual: [first, last, f.counts.lookup],
        expected: [{ status: 'loading_profile' }, { status: 'failed', reason: 'profile_unreadable' }, 0],
      })
    })
  },
)
