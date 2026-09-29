import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'playwright'
import { z } from 'zod'
import type { SignInResult } from '#lib/browser/signIn/broker.ts'
import { ProfileEvidence, readProfileEvidence, visibleProfileName } from './evidence.ts'
import { linkedInUrl } from './types.ts'

export const LinkedInBrowserResult = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['opening', 'signing_in', 'waiting', 'needs_user', 'loading_profile', 'reading']) }),
  z.object({ status: z.literal('failed'), reason: z.literal('profile_unreadable') }),
  z.object({ status: z.literal('ready'), profile: ProfileEvidence }),
])
export type LinkedInBrowserResult = z.infer<typeof LinkedInBrowserResult>

/** Trusted workflow inside the private browser worker. No page controls or authentication data leave it. */
export class LinkedInBrowserImport {
  private readonly url: string
  private phase: 'open' | 'check' | 'sign_in' | 'read' | 'done' = 'open'
  private attemptedSignIn = false
  private openedLogin = false
  private profileWaitingSince: number | undefined

  constructor(
    url: string,
    private readonly page: Page,
    private readonly signIn: (signal?: AbortSignal) => Promise<SignInResult>,
    private readonly redact: (text: string) => string,
  ) {
    this.url = linkedInUrl(url)
  }

  private atTarget(): boolean {
    try {
      return linkedInUrl(this.page.url()).toLowerCase() === this.url.toLowerCase()
    } catch {
      return false
    }
  }

  private async authenticationVisible(): Promise<boolean> {
    return (
      (await this.page
        .locator(
          'input[type="password"]:visible, input[autocomplete~="username"]:visible, input[autocomplete~="one-time-code"]:visible, input[name="pin" i]:visible, input[name="verificationCode" i]:visible',
        )
        .count()) > 0
    )
  }

  private async profileVisible(): Promise<boolean> {
    return this.atTarget() && !(await this.authenticationVisible()) && !!(await visibleProfileName(this.page))
  }

  async step(signal?: AbortSignal): Promise<LinkedInBrowserResult> {
    signal?.throwIfAborted()
    if (this.page.isClosed() || this.phase === 'done') throw new Error('Import browser unavailable')
    if (this.phase === 'open') {
      this.phase = 'check'
      await this.page.goto(this.url, { waitUntil: 'domcontentloaded' })
      return { status: 'opening' }
    }
    const current = new URL(this.page.url())
    if (current.origin !== 'https://www.linkedin.com') throw new Error('Import left LinkedIn')
    const atLogin = /^\/(?:login|uas\/login)(?:\/|$)/.test(current.pathname)
    if (atLogin) this.openedLogin = true
    if (this.phase === 'sign_in') {
      this.phase = 'check'
      this.attemptedSignIn = true
      const outcome = await this.signIn(signal)
      return { status: outcome.status === 'submitted' ? 'waiting' : 'needs_user' }
    }
    if (this.phase === 'read') {
      if (!(await this.profileVisible())) throw new Error('Import profile changed')
      for (let step = 0; step < 4; step++) {
        signal?.throwIfAborted()
        await this.page.mouse.wheel(0, 650)
        await delay(400, undefined, { signal })
      }
      if (!(await this.profileVisible())) throw new Error('Import profile changed')
      const source = await readProfileEvidence(this.page, this.url)
      if (!(await this.profileVisible()) || !source.name) throw new Error('Import profile changed')
      this.phase = 'done'
      return {
        status: 'ready',
        profile: {
          url: this.redact(source.url),
          name: this.redact(source.name),
          text: this.redact(source.text),
          companies: source.companies.map(({ name, url }) => ({ name: this.redact(name), url: this.redact(url) })),
        },
      }
    }
    if (await this.profileVisible()) {
      this.phase = 'read'
      return { status: 'reading' }
    }
    if (this.atTarget() && !(await this.authenticationVisible())) {
      this.profileWaitingSince ??= performance.now()
      if (performance.now() - this.profileWaitingSince > 20_000) {
        this.phase = 'done'
        return { status: 'failed', reason: 'profile_unreadable' }
      }
      return { status: 'loading_profile' }
    }
    this.profileWaitingSince = undefined
    if (/^\/(?:feed|mynetwork)(?:\/|$)/.test(current.pathname)) {
      await this.page.goto(this.url, { waitUntil: 'domcontentloaded' })
      return { status: 'opening' }
    }
    // Use LinkedIn's password login rather than its guest-page registration form.
    if (!this.openedLogin && (this.atTarget() || /^\/authwall(?:\/|$)/.test(current.pathname))) {
      this.openedLogin = true
      await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' })
      return { status: 'opening' }
    }
    const passwordLogin = atLogin && (await this.page.locator('input[type="password"]:visible').count()) > 0
    if (passwordLogin && !this.attemptedSignIn) {
      this.phase = 'sign_in'
      return { status: 'signing_in' }
    }
    return { status: 'needs_user' }
  }
}
