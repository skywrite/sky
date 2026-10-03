import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext, ElementHandle, Page } from 'playwright'
import { secureOrigin, type LoginValues } from '#lib/credentials/login.ts'
import { guardBrowserRequests } from './signIn/network.ts'
import { LoginRedactor } from './signIn/redaction.ts'

// A sign-in with a login the person stored for one integration — the batch
// counterpart of the private worker's `sign_in`, for a feature that owns a
// persistent profile of its own (see persistentContext.ts) and runs with no
// one watching. The grant is the stored login itself: a `login` entry the
// person saved under the integration's own category in Sky's keychain, read
// through the same background path as every API token Sky holds. Nothing here
// is reachable by a model: the site, its page and its controls are named in
// the integration's code, the values go from the keychain to Playwright
// element handles and nowhere else, the private worker's network guard keeps
// them on the login's own origin, and every line said about the attempt is
// redacted. A human check the site insists on is reported, never operated.

export interface StoredLoginForm {
  /** The HTTPS page carrying the login form. Filling, and everything after it, stay on this origin. */
  loginUrl: string
  /** Selectors for the site's own controls, written in the integration's code — never supplied by a model. */
  username: string
  password: string
  submit: string
  /**
   * A hidden field a bot wall fills on its own when it lets the visitor through
   * (Cloudflare Turnstile's `cf-turnstile-response`). The sign-in waits for it
   * and never operates the widget: a check the wall wants a person to pass ends
   * the attempt as `needs_person`.
   */
  verificationToken?: string
}

export type StoredLoginStatus = 'signed_in' | 'needs_person' | 'rejected' | 'unavailable'

export interface StoredLoginResult {
  status: StoredLoginStatus
  /** Plain words for the person. Fixed phrases, never page text, which could echo the login. */
  reason: string
}

export interface StoredLoginOptions {
  /** The caller's own proof of a session — a token read, an account page. A submitted form proves nothing. */
  signedIn: () => Promise<boolean>
  /** Progress, in fixed phrases, already redacted. */
  log?: (line: string) => void
  /** How long the site gets to answer the submitted form. */
  timeoutMs?: number
  /** How long an invisible bot check gets to pass on its own. */
  verificationWaitMs?: number
}

// A framework's controls appear after the first paint; look again for a while.
const HYDRATION_TRIES = 25
const HYDRATION_PAUSE_MS = 200
// An invisible bot check usually settles in a few seconds; longer means it wants a person.
const VERIFICATION_WAIT_MS = 20_000
const ANSWER_WAIT_MS = 30_000
const SETTLE_MS = 1500

interface Guard {
  origin?: string
  redactor: LoginRedactor
}

// One guard per page, however many sign-ins run on it: the network rules and
// the redactor accumulate, they are never installed twice.
const guards = new WeakMap<Page, Guard>()

async function guardFor(page: Page): Promise<Guard> {
  let guard = guards.get(page)
  if (guard) return guard
  guard = { redactor: new LoginRedactor() }
  guards.set(page, guard)
  await guardBrowserRequests(page, {
    origin: () => guards.get(page)?.origin,
    containsLogin: (text) => guards.get(page)?.redactor.contains(text) ?? false,
  })
  return guard
}

const normalPath = (pathname: string): string => pathname.replace(/\/+$/, '') || '/'

interface Controls {
  username: ElementHandle<HTMLInputElement>
  password: ElementHandle<HTMLInputElement>
  submit: ElementHandle<HTMLElement>
  /** Everything the fill relies on, checked again in the page right before each step. */
  current(): Promise<boolean>
  dispose(): Promise<void>
}

async function captureControls(
  page: Page,
  form: StoredLoginForm,
  origin: string,
  loginPath: string,
): Promise<Controls | null> {
  const one = async <T extends HTMLElement>(selector: string): Promise<ElementHandle<T> | null> => {
    const locator = page.locator(selector).filter({ visible: true })
    if ((await locator.count()) !== 1) return null
    return (await locator.elementHandle()) as ElementHandle<T> | null
  }
  const username = await one<HTMLInputElement>(form.username)
  const password = await one<HTMLInputElement>(form.password)
  const submit = await one<HTMLElement>(form.submit)
  const dispose = async () => {
    await Promise.allSettled([username?.dispose(), password?.dispose(), submit?.dispose()])
  }
  if (!username || !password || !submit) {
    await dispose()
    return null
  }
  const current = async (): Promise<boolean> => {
    try {
      return await password.evaluate(
        (password, { username, submit, origin, loginPath }) => {
          const visible = (element: Element) =>
            element.isConnected &&
            document.contains(element) &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
          const pathname = location.pathname.replace(/\/+$/, '') || '/'
          return (
            window === window.top &&
            location.origin === origin &&
            pathname === loginPath &&
            visible(password) &&
            visible(username) &&
            visible(submit) &&
            password.type === 'password' &&
            password.autocomplete !== 'new-password' &&
            !password.disabled &&
            !password.readOnly &&
            ['text', 'email'].includes(username.type) &&
            !username.disabled &&
            !username.readOnly &&
            (submit instanceof HTMLButtonElement || submit instanceof HTMLInputElement) &&
            !submit.disabled &&
            // A form may hand its submission to the page's own script (a GET
            // form does on this kind of site) but never to another window.
            (!password.form || password.form.target === '' || password.form.target === '_self')
          )
        },
        { username, submit, origin, loginPath },
      )
    } catch {
      return false
    }
  }
  if (!(await current())) {
    await dispose()
    return null
  }
  return { username, password, submit, current, dispose }
}

/**
 * Sign in on a page of the integration's own persistent profile with a login
 * the person stored for it. Returns how it went; the caller decides what to
 * say and what to do next. A session is `signed_in` only when the caller's own
 * check says so.
 */
export async function signInWithStoredLogin(
  context: BrowserContext,
  form: StoredLoginForm,
  login: LoginValues,
  options: StoredLoginOptions,
): Promise<StoredLoginResult> {
  const origin = secureOrigin(form.loginUrl)
  if (!origin) return { status: 'unavailable', reason: 'The login page must be an HTTPS address.' }
  if (!login.username.use((value) => value) || !login.password.use((value) => value))
    return { status: 'unavailable', reason: 'The stored login is missing its email or password.' }
  const loginPath = normalPath(new URL(form.loginUrl).pathname)
  const values = login

  const page = context.pages()[0] ?? (await context.newPage())
  const guard = await guardFor(page)
  guard.redactor.remember(values)
  const say = (line: string) => options.log?.(guard.redactor.text(line))
  const outcome = (status: StoredLoginStatus, reason: string): StoredLoginResult => {
    say(reason)
    return { status, reason }
  }
  const onLoginPage = (): boolean => {
    try {
      const url = new URL(page.url())
      return url.origin === origin && normalPath(url.pathname) === loginPath
    } catch {
      return false
    }
  }

  say('Opening the sign-in page.')
  try {
    await page.goto(form.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } catch {
    return outcome('unavailable', 'The sign-in page did not load.')
  }

  let controls: Controls | null = null
  for (let attempt = 0; attempt < HYDRATION_TRIES && !controls && onLoginPage(); attempt++) {
    controls = await captureControls(page, form, origin, loginPath)
    if (!controls) await delay(HYDRATION_PAUSE_MS)
  }
  if (!controls) {
    // Sent away from the sign-in page: a session may already be there.
    if (!onLoginPage() && (await options.signedIn())) return outcome('signed_in', 'The session was still valid.')
    return outcome('needs_person', 'The sign-in page did not show the expected login form.')
  }

  try {
    // Fill first: in a window a person is watching, their part is then only the
    // site's check and the button. From here on nothing may leave the origin.
    guard.origin = origin
    if (!(await controls.current()))
      return outcome('needs_person', 'The sign-in page changed before the login was entered.')
    await values.username.use((value) => controls!.username.fill(value, { timeout: 5000 }))
    if (!(await controls.current()))
      return outcome('needs_person', 'The sign-in page changed while the login was entered.')
    await values.password.use((value) => controls!.password.fill(value, { timeout: 5000 }))
    if (!(await controls.current()))
      return outcome('needs_person', 'The sign-in page changed while the login was entered.')

    if (form.verificationToken) {
      const token = page.locator(form.verificationToken).first()
      if ((await token.count()) > 0) {
        say('Waiting for the site’s check to pass on its own.')
        const deadline = performance.now() + (options.verificationWaitMs ?? VERIFICATION_WAIT_MS)
        let passed = false
        while (performance.now() < deadline && !passed) {
          passed = (await token.inputValue({ timeout: 1000 }).catch(() => '')) !== ''
          if (!passed) {
            if (!(await controls.current()))
              return outcome('needs_person', 'The sign-in page changed while waiting for the site’s check.')
            await delay(500)
          }
        }
        if (!passed) return outcome('needs_person', 'The site wants a person to pass its check before signing in.')
      }
    }

    if (!(await controls.current()))
      return outcome('needs_person', 'The sign-in page changed before the login was sent.')
    await controls.submit.click({ timeout: 5000 })
    say('Sent the stored login.')
  } catch {
    return outcome('unavailable', 'The login could not be entered on the page.')
  } finally {
    await controls.dispose()
  }

  const deadline = performance.now() + (options.timeoutMs ?? ANSWER_WAIT_MS)
  while (performance.now() < deadline) {
    await delay(500)
    if (page.isClosed()) return outcome('unavailable', 'The browser closed during the sign-in.')
    if (!onLoginPage()) {
      let url: URL | undefined
      try {
        url = new URL(page.url())
      } catch {
        /* about:blank between pages */
      }
      if (url && url.origin !== origin)
        return outcome('unavailable', 'The site left its own address during the sign-in.')
      await delay(SETTLE_MS)
      return (await options.signedIn())
        ? outcome('signed_in', 'Signed in with the stored login.')
        : outcome('unavailable', 'The site moved on from the sign-in page, but no session followed.')
    }
    if (await codeVisible(page)) return outcome('needs_person', 'The site asked for a verification code.')
    if (await refusalVisible(page))
      return outcome('rejected', 'The site turned the login away: the stored email or password is wrong.')
  }
  return outcome('needs_person', 'The site did not sign in; a person should look at the sign-in page.')
}

async function codeVisible(page: Page): Promise<boolean> {
  return (
    (await page
      .locator(
        'input[autocomplete~="one-time-code"]:visible, input[name*="code" i]:visible, input[name*="otp" i]:visible, input[inputmode="numeric"]:visible',
      )
      .count()) > 0
  )
}

async function refusalVisible(page: Page): Promise<boolean> {
  return (
    (await page
      .locator('[role="alert"]:visible, [aria-live]:visible, [class*="error" i]:visible')
      .filter({
        hasText: /incorrect|invalid|wrong|does not match|doesn.t match|not recogni[sz]ed|no account|try again/i,
      })
      .count()) > 0
  )
}
