import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext, Page } from 'playwright'
import { withGoogleBrowser, type GoogleBrowserSession } from './browserSession.ts'

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
  return withGoogleBrowser({ headless: true, closeAfter: true, signal }, async ({ page }) => {
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
    (session) => signInGoogleBrowserSession(session, options),
  )
}

export async function signInGoogleBrowserSession(
  session: Pick<GoogleBrowserSession, 'context' | 'page' | 'existing' | 'close'>,
  { account, signal, onOpened }: { account?: string; signal?: AbortSignal; onOpened?: () => void },
): Promise<void> {
  const { context, page } = session
  const ownedTabs = new Set<Page>([page])
  const onPopup = (popup: Page) => {
    ownedTabs.add(popup)
  }
  let closed = false
  let closing: Promise<void> | undefined
  const onClose = () => {
    closed = true
  }
  const cancel = () => {
    closing ??= session.close().catch(() => {})
  }
  page.on('popup', onPopup)
  page.on('close', onClose)
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
    // In a connected browser, inspect only tabs opened for this sign-in — never unrelated personal tabs.
    const candidateTabs = () => (session.existing ? [...ownedTabs].filter((tab) => !tab.isClosed()) : context.pages())
    const signedIn = async () => {
      for (const tab of candidateTabs()) {
        if (account ? await calendarBrowserSignedIn(tab, account) : new URL(tab.url()).hostname === 'drive.google.com')
          return true
      }
      return false
    }
    for (let waited = 0; waited < 600_000; waited += 1500) {
      signal?.throwIfAborted()
      if (closed || page.isClosed())
        throw new Error('The sign-in window was closed. Open it again to finish signing in.')
      if (await signedIn()) {
        await delay(2500, undefined, { signal })
        if (!closed && !page.isClosed() && (await signedIn())) return
      }
      await delay(1500, undefined, { signal })
    }
    throw new Error('Sign-in timed out. Open the Google sign-in window again to continue.')
  } finally {
    signal?.removeEventListener('abort', cancel)
    await closing
    page.off('popup', onPopup)
    page.off('close', onClose)
    context.off('close', onClose)
  }
}

/** The browser boundary is injectable so sign-in can be verified without a real account. */
export async function signInGoogleBrowserContext(
  context: BrowserContext,
  options: { account?: string; signal?: AbortSignal; onOpened?: () => void },
): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage())
  await signInGoogleBrowserSession(
    {
      context,
      page,
      existing: false,
      close: () => context.close(),
    },
    options,
  )
}
