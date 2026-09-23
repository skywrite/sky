import type { Page } from 'playwright'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { startLoopback } from '../loopback.ts'
import { GOOGLE_SCOPES, buildAuthUrl, exchangeCode, fetchAccountEmail, generatePkce, randomState } from '../oauth.ts'
import type { OAuthClient } from '../oauth.ts'
import { projectClientEntryName, saveAccountTokens } from '../tokens.ts'
import { StepFailed, goTo, hostOf } from './page.ts'

// The grant itself, in the same window: Google's permission pages for the
// client Sky just made. Sky picks the account, clicks past the "unverified
// app" warning — the client is the person's own, made a minute ago — ticks
// every box and presses Continue: the person agreed to all of it on Sky's
// start screen. The redirect lands on this machine, the way `sky
// google:auth` does it.

/** Ticking the boxes takes a moment; a window left open should not hold the run forever. */
export const CONSENT_DEADLINE_MS = 10 * 60_000

const WARNING_POLL_MS = 1000

/**
 * Google's unverified-app page for the person's own client: "Advanced", then
 * "Go to Sky (unsafe)". Only ever on accounts.google.com, and only while the
 * page names the warning — anything else is left alone.
 */
async function passUnverifiedWarning(page: Page): Promise<void> {
  if (hostOf(page) !== 'accounts.google.com') return
  const warned = await page
    .getByText(/hasn.t verified this app/i)
    .first()
    .isVisible()
    .catch(() => false)
  if (!warned) return
  const advanced = page.getByRole('button', { name: /^advanced$/i }).or(page.getByText(/^advanced$/i))
  await advanced
    .first()
    .click({ timeout: 2000 })
    .catch(() => undefined)
  const unsafe = page.getByRole('link', { name: /\(unsafe\)/i }).or(page.getByText(/\(unsafe\)/i))
  await unsafe
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined)
}

/**
 * Google's account chooser, when it asks which account grants: the one
 * signed in to this window is the only one there. Picking it is not the
 * grant — the boxes come after — so Sky does it.
 */
async function pickAccount(page: Page, email?: string): Promise<void> {
  if (hostOf(page) !== 'accounts.google.com') return
  const chooser = await page
    .getByText(/choose an account/i)
    .first()
    .isVisible()
    .catch(() => false)
  if (!chooser) return
  const account = email ? page.locator(`[data-identifier="${email}"]`) : page.locator('[data-identifier]')
  await account
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined)
}

/**
 * Google's own pages for the grant — the identity page, then the boxes.
 * The person agreed to all of it on Sky's start screen, so Sky ticks every
 * box and presses Continue; it never presses Cancel.
 */
async function advanceConsent(page: Page): Promise<void> {
  if (hostOf(page) !== 'accounts.google.com') return
  const boxes = page.getByRole('checkbox')
  const count = await boxes.count().catch(() => 0)
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i)
    const checked = await box.isChecked().catch(() => true)
    if (!checked) await box.check({ timeout: 2000 }).catch(() => box.click({ timeout: 2000 }).catch(() => undefined))
  }
  const go = page.getByRole('button', { name: /^(continue|allow)$/i })
  if (
    await go
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await go
      .first()
      .click({ timeout: 3000 })
      .catch(() => undefined)
  }
}

export interface ConsentOptions {
  secrets: SecretsProvider
  projectId: string
  client: OAuthClient
  /** The account expected to grant; Google skips its chooser for a signed-in hint */
  email?: string
  onWaiting: () => void
}

/** Runs the grant; resolves with the account that granted. */
export async function consent(page: Page, options: ConsentOptions): Promise<string> {
  const pkce = await generatePkce()
  const state = randomState()
  const loopback = await startLoopback(state)
  try {
    const url = buildAuthUrl({
      clientId: options.client.clientId,
      redirectUri: loopback.redirectUri,
      challenge: pkce.challenge,
      state,
      ...(options.email ? { loginHint: options.email } : {}),
    })
    await goTo(page, url)
    options.onWaiting()

    // The chooser and the warning can appear late — after a re-sign-in,
    // say — so both are watched for the whole wait; a closed window ends the
    // wait instead of leaving the receiver listening for ten minutes.
    let watching = true
    let windowClosed: () => void = () => undefined
    const closed = new Promise<never>((_, reject) => {
      windowClosed = () => reject(new StepFailed('The window closed before Google answered'))
    })
    closed.catch(() => undefined)
    const watch = (async () => {
      while (watching) {
        if (page.isClosed()) {
          windowClosed()
          return
        }
        await pickAccount(page, options.email).catch(() => undefined)
        await passUnverifiedWarning(page).catch(() => undefined)
        await advanceConsent(page).catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, WARNING_POLL_MS))
      }
    })()
    let code: string
    try {
      const answer = loopback.waitForCode({ timeoutMs: CONSENT_DEADLINE_MS })
      answer.catch(() => undefined)
      code = await Promise.race([answer, closed])
    } catch (err) {
      throw err instanceof StepFailed ? err : new StepFailed(err instanceof Error ? err.message : String(err))
    } finally {
      watching = false
      await watch
    }

    const tokens = await exchangeCode({
      client: options.client,
      code,
      verifier: pkce.verifier,
      redirectUri: loopback.redirectUri,
    })
    if (!tokens.refresh_token) throw new StepFailed('Google returned no refresh token — connect again')
    const email = await fetchAccountEmail(tokens.access_token)
    await saveAccountTokens(options.secrets, email, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      scopes: (tokens.scope ?? GOOGLE_SCOPES.join(' ')).split(' '),
      client: projectClientEntryName(options.projectId),
      setup: { projectId: options.projectId, at: new Date().toISOString() },
    })
    return email
  } finally {
    loopback.close()
  }
}
