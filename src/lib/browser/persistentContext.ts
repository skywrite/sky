import { execFileSync } from 'node:child_process'
import { readlink, rm } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type { BrowserContext, Page } from 'playwright'
import { exists } from '#shared/fs/mod.ts'

// A generic, batch-oriented persistent browser profile. A command signs the
// user in once (headed) and the cookies persist in the profile dir; later
// runs launch headless against the same profile and reach an authenticated
// site through a real browser — the only way past bot walls (Cloudflare) and
// login captchas that refuse a scripted POST. This is the plumbing under
// features an app's API won't expose to a script; the app-specific bits
// (which URL, how to tell signed-in from signed-out) live in the caller.
//
// Unlike the Google automation session (commands/all/google/lib), this has no
// warm-pool or cross-process lock: it is meant for a lone daily batch, so each
// call is a clean launch → use → close. Do not point two concurrent flows at
// the same profile dir — Chromium allows one process per profile.

const CHROMIUM_PATHS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/** First installed Chromium-family browser, or null when none is present. */
export async function findChromiumBrowser(): Promise<string | null> {
  for (const binary of CHROMIUM_PATHS) {
    if (await exists(binary)) return binary
  }
  return null
}

export class NoBrowserError extends Error {
  constructor() {
    super('No Chromium-family browser found — install Brave, Google Chrome, Chromium, or Edge')
    this.name = 'NoBrowserError'
  }
}

export interface JsonResponse<T> {
  status: number
  ok: boolean
  /** Final URL after redirects — a redirect to a login page reveals a dead session. */
  url: string
  /** Parsed body, or null when the response was not JSON. */
  json: T | null
  /** Raw body — useful for diagnosing a non-JSON (challenge page) response. */
  text: string
}

/** What a caller does with an open, cookie-bearing browser profile. */
export interface BrowserSession {
  /**
   * Navigate a real page. This is what refreshes a bot-wall clearance cookie
   * (Cloudflare's cf_clearance): the page runs the challenge JS that a bare
   * request cannot. Returns the URL actually landed on (after redirects).
   */
  visit(
    url: string,
    opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number },
  ): Promise<string>
  /**
   * GET JSON through the browser's own network stack (APIRequestContext) —
   * carries the profile's cookies, is exempt from CORS, and takes custom
   * headers (a Bearer token), so it reaches an authenticated app JSON API.
   * Never throws on HTTP status; inspect `ok`. Caveat: a response that
   * *redirects* while setting a cookie can trip a Set-Cookie parse bug in
   * playwright and reject — use {@link navigateForJson} to probe endpoints
   * that redirect when signed out.
   */
  getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<JsonResponse<T>>
  /**
   * GET JSON by navigating a real page. Follows redirects natively (so a dead
   * session lands on the login page — read it off `url`) and sidesteps the
   * APIRequestContext redirect bug, but cannot send custom headers. Use it to
   * probe sign-in state; use {@link getJson} for authenticated API calls.
   */
  navigateForJson<T = unknown>(url: string): Promise<JsonResponse<T>>
  /**
   * The primary page's current URL, read live (no navigation, no request). Poll
   * it to watch where an interactive sign-in has taken the user — the only way
   * to track sign-in progress without an HTTP call that would trip the redirect
   * bug or a navigation that would yank the page out from under them.
   */
  currentUrl(): string
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0) // signal 0 = liveness probe; throws if the pid is gone
    return true
  } catch {
    return false
  }
}

/** Full command line of a pid, or null when it can't be read (usually: just died). */
function commandLineOf(pid: number): string | null {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  } catch {
    return null
  }
}

/**
 * A SingletonLock left by a previous run blocks every future launch. If the pid
 * it names is dead, clear the lock files. If it's alive it holds the profile —
 * normally leave it (launch should fail loudly, not race a real browser), but
 * with `takeover` the caller asserts this profile is theirs alone, so a live
 * holder can only be their own crash orphan: kill it (after confirming its
 * command line names this profile dir, never an unrelated pid-reuse) and clear.
 */
async function clearProfileLock(profileDir: string, takeover: boolean): Promise<void> {
  try {
    const target = await readlink(path.join(profileDir, 'SingletonLock'))
    const pid = Number.parseInt(target.split('-').pop() ?? '', 10)
    if (Number.isFinite(pid) && isAlive(pid)) {
      if (!takeover) return // a live browser holds the profile; don't disturb it
      const command = commandLineOf(pid)
      if (!command || !command.includes(profileDir)) return // not ours — leave it
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone, or not ours to kill — fall through and try to clear
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } catch {
    return // no SingletonLock to clear
  }
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await rm(path.join(profileDir, name), { force: true }).catch(() => undefined)
  }
}

/**
 * Open a persistent browser profile, hand the caller a {@link BrowserSession},
 * and always close the browser afterward. Headless by default; pass
 * `headless: false` for an interactive sign-in window. Pass `takeover: true`
 * when the profile is this feature's alone, so a browser left behind by a
 * crashed run is killed instead of blocking the launch.
 */
export async function withPersistentBrowser<T>(
  opts: { profileDir: string; headless?: boolean; timeoutMs?: number; takeover?: boolean },
  fn: (session: BrowserSession, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const executablePath = await findChromiumBrowser()
  if (!executablePath) throw new NoBrowserError()

  await clearProfileLock(opts.profileDir, opts.takeover ?? false)

  const context = await chromium.launchPersistentContext(opts.profileDir, {
    executablePath,
    headless: opts.headless ?? true,
    viewport: { width: 1280, height: 900 },
    timeout: opts.timeoutMs ?? 60_000,
    // Playwright defaults the sandbox off; keep it up for a profile that loads
    // real third-party web pages.
    chromiumSandbox: true,
    // Strip the automation fingerprint. The point of this helper is to look
    // like a real browser to the site, and bot walls (Cloudflare Turnstile on
    // a login form) reject the tells Playwright adds by default: the
    // `--enable-automation` switch and `navigator.webdriver`.
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })

  // Belt-and-suspenders: mask webdriver before any page script runs, for tells
  // the launch flags don't fully cover.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  try {
    const page: Page = context.pages()[0] ?? (await context.newPage())
    const session: BrowserSession = {
      async visit(url, o) {
        await page.goto(url, { waitUntil: o?.waitUntil ?? 'domcontentloaded', timeout: o?.timeoutMs ?? 60_000 })
        return page.url()
      },
      async getJson<R = unknown>(url: string, headers?: Record<string, string>): Promise<JsonResponse<R>> {
        const res = await context.request.get(url, { headers, failOnStatusCode: false })
        const text = await res.text()
        return { status: res.status(), ok: res.ok(), url: res.url(), json: parseJson<R>(text), text }
      },
      async navigateForJson<R = unknown>(url: string): Promise<JsonResponse<R>> {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        const status = resp?.status() ?? 0
        const text = resp ? await resp.text() : ''
        return { status, ok: status >= 200 && status < 300, url: page.url(), json: parseJson<R>(text), text }
      },
      currentUrl() {
        return page.url()
      },
    }
    return await fn(session, context)
  } finally {
    await context.close().catch(() => undefined)
  }
}
