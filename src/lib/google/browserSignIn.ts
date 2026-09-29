import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext, Page } from 'playwright'
import { withGoogleBrowser } from './browserSession.ts'

export class GoogleBrowserSignInRequired extends Error {
  readonly code = 'google_browser_sign_in_required'
}

export const googleBrowserSignInMessage =
  'Sign in to Google in Sky’s browser to continue. Use Sign in to Google in the meeting card, or run sky google:browser on the computer running Sky.'

export const calendarBrowserUrl = (account: string) =>
  `https://calendar.google.com/calendar/u/0/r?authuser=${encodeURIComponent(account)}`

/** Read only account identity; neither a cookie nor a redirect alone proves the selected account is ready. */
export async function calendarBrowserSignedIn(page: Page, account: string): Promise<boolean> {
  if (new URL(page.url()).hostname !== 'calendar.google.com') return false
  const identity = page.getByRole('button', { name: /^Google Account:/ }).first()
  if (!(await identity.isVisible())) return false
  return (await identity.ariaSnapshot()).toLowerCase().includes(`(${account.toLowerCase()})`)
}

export async function checkCalendarBrowserSignIn(account: string, signal?: AbortSignal): Promise<boolean> {
  return withGoogleBrowser({ headless: true, signal }, async (context) => {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(calendarBrowserUrl(account), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (new URL(page.url()).hostname !== 'calendar.google.com') return false
    await page
      .getByRole('button', { name: /^Google Account:/ })
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {})
    signal?.throwIfAborted()
    return calendarBrowserSignedIn(page, account)
  })
}

/** Shared by the terminal command and the meeting card; opening this window never creates an event. */
export async function signInGoogleBrowser(
  options: {
    account?: string
    signal?: AbortSignal
    onOpened?: () => void
  } = {},
): Promise<void> {
  await withGoogleBrowser(
    { headless: false, closeAfter: true, timeoutMs: 660_000, signal: options.signal },
    (context) => signInGoogleBrowserContext(context, options),
  )
}

/** The browser boundary is injectable so sign-in can be verified without a real account. */
export async function signInGoogleBrowserContext(
  context: BrowserContext,
  { account, signal, onOpened }: { account?: string; signal?: AbortSignal; onOpened?: () => void },
): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage())
  let closed = false
  let closing: Promise<void> | undefined
  const onClose = () => {
    closed = true
  }
  const cancel = () => {
    closing ??= context.close().catch(() => {})
  }
  context.on('close', onClose)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    const destination = account ? calendarBrowserUrl(account) : 'https://drive.google.com'
    await page.goto(`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(destination)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    onOpened?.()
    const signedIn = async () => {
      for (const tab of context.pages()) {
        if (account ? await calendarBrowserSignedIn(tab, account) : new URL(tab.url()).hostname === 'drive.google.com')
          return true
      }
      return false
    }
    for (let waited = 0; waited < 600_000; waited += 1500) {
      signal?.throwIfAborted()
      if (closed) throw new Error('The sign-in window was closed. Open it again to finish signing in.')
      if (await signedIn()) {
        await delay(2500, undefined, { signal })
        if (!closed && (await signedIn())) return
      }
      await delay(1500, undefined, { signal })
    }
    throw new Error('Sign-in timed out. Open the Google sign-in window again to continue.')
  } finally {
    signal?.removeEventListener('abort', cancel)
    await closing
    context.off('close', onClose)
  }
}
