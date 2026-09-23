import type { Page } from 'playwright'
import { GOOGLE_CONSOLE_URL } from '../setup.ts'
import { StepFailed, appears, click, goTo, hostOf, urlBecomes } from './page.ts'

// The person signs in; Sky only watches for the console to appear. A first
// visit to the console asks for the Cloud terms — agreed to on Sky's start
// screen, so Sky ticks the box.

const SIGNIN_URL = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(`${GOOGLE_CONSOLE_URL}/`)}`

/** Sign-in with 2FA takes minutes; a window forgotten open should not hold the run forever. */
export const SIGNIN_DEADLINE_MS = 10 * 60_000

export const CONSOLE_HOST = 'console.cloud.google.com'

export async function signIn(page: Page, options: { onWaiting: () => void }): Promise<void> {
  await goTo(page, SIGNIN_URL)
  if (hostOf(page) !== CONSOLE_HOST) {
    options.onWaiting()
    const landed = await urlBecomes(page, (url) => url.hostname === CONSOLE_HOST, SIGNIN_DEADLINE_MS)
    if (!landed) throw new StepFailed('No completed sign-in after ten minutes')
  }
  await agreeToCloudTerms(page)
}

/** The welcome dialog a new console visitor gets; a returning one has none. */
async function agreeToCloudTerms(page: Page): Promise<void> {
  const terms = page.getByRole('checkbox', { name: /terms of service/i })
  if (!(await appears(terms, 8000))) return
  await terms
    .first()
    .check({ timeout: 10_000 })
    .catch(() => undefined)
  await click(page.getByRole('button', { name: /agree and continue/i }), 'the Agree and continue button')
}
