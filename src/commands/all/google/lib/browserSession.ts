import { readlink, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type { BrowserContext, Page } from 'playwright'
import { exists } from '#shared/fs/mod.ts'

// A dedicated persistent browser profile for Google UI automation. Google
// blocks CDP attachment to a browser's default profile (Chromium 136+), so
// the automation session lives in its own profile: the user signs in once
// via `sky google:browser`, and the cookies persist. This exists for the
// features Google's APIs refuse to expose — e.g. anchored comments.

export const GOOGLE_BROWSER_PROFILE_DIR = path.join(os.homedir(), '.sky', 'google-browser-profile')

export const CHROMIUM_PATHS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export async function findChromiumBrowser(): Promise<string | null> {
  for (const binary of CHROMIUM_PATHS) {
    if (await exists(binary)) return binary
  }
  return null
}

export class GoogleBrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleBrowserError'
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Chromium refuses to start on a profile whose SingletonLock names another
 * process. A crashed or Ctrl-C'd run leaves the lock (and sometimes a whole
 * orphaned browser) behind — self-heal the stale case, name the live one.
 */
async function clearProfileLockOrThrow(): Promise<void> {
  const lockPath = path.join(GOOGLE_BROWSER_PROFILE_DIR, 'SingletonLock')
  let target: string
  try {
    target = await readlink(lockPath)
  } catch {
    return
  }
  const pid = Number.parseInt(target.split('-').pop() ?? '', 10)
  if (Number.isFinite(pid) && isProcessAlive(pid)) {
    throw new GoogleBrowserError(
      `The automation profile is already in use by a running browser (pid ${pid}) — close that window, or: kill ${pid}`,
    )
  }
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await rm(path.join(GOOGLE_BROWSER_PROFILE_DIR, name), { force: true }).catch(() => undefined)
  }
}

/** Launch the persistent automation profile. Callers must close() the context. */
export async function launchGoogleBrowser(options: { headless?: boolean } = {}): Promise<BrowserContext> {
  const executablePath = await findChromiumBrowser()
  if (!executablePath) {
    throw new GoogleBrowserError('No Chromium-family browser found for automation')
  }
  await clearProfileLockOrThrow()
  return await chromium.launchPersistentContext(GOOGLE_BROWSER_PROFILE_DIR, {
    executablePath,
    headless: options.headless ?? false,
    viewport: { width: 1440, height: 900 },
  })
}

// Chromium allows one process per profile dir, so concurrent flows collide:
// the loser throws on the SingletonLock or, losing the startup race, hangs
// in launch until its 3-minute timeout. Agent missions DO issue browser
// tool calls concurrently (the AI SDK runs a step's tool calls in
// parallel) — queue whole flows instead of letting them fight.
let profileQueue: Promise<unknown> = Promise.resolve()

/** Run one launch → work → close flow with exclusive use of the automation profile. */
export async function withGoogleBrowser<T>(
  options: { headless?: boolean },
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const run = profileQueue.then(async () => {
    const context = await launchGoogleBrowser(options)
    try {
      return await fn(context)
    } finally {
      await context.close()
    }
  })
  profileQueue = run.catch(() => undefined)
  return await run
}

// Signed-out redirects land on the account chooser for editor URLs, but on
// the marketing site for bare drive.google.com — treat both as signed out.
const LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'workspace.google.com']

/** Does this URL mean Google bounced a signed-out visitor? */
export function isSignedOutUrl(url: string): boolean {
  return LOGIN_HOSTS.some((host) => url.includes(host))
}

/** Open a Google URL in the automation profile; throws when the profile is signed out. */
export async function openGooglePage(context: BrowserContext, url: string): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(4000)
  if (isSignedOutUrl(page.url())) {
    throw new GoogleBrowserError('The automation browser is signed out of Google. Run: sky google:browser')
  }
  return page
}
