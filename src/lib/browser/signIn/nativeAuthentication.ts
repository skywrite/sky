import type { Page } from 'playwright'
import { secureOrigin } from '#lib/credentials/login.ts'

export interface NativeAuthenticationApproval {
  method(origin: string): Promise<'password' | 'browser' | null>
  begin(origin: string): Promise<boolean>
  provider(origin: string, destination: string): Promise<boolean>
  finish(origin: string): Promise<boolean>
}

/** A bounded human-owned authentication window. No URL, approval, cookie, or assertion RPC. */
export class NativeAuthentication {
  private origin: string | undefined
  private deadline = 0
  private readonly providers = new Map<string, Promise<boolean>>()
  private stopped = false

  constructor(
    private readonly approval: NativeAuthenticationApproval,
    private readonly now = () => performance.now(),
  ) {}

  get active(): boolean {
    return !!this.origin && !this.stopped && this.now() < this.deadline
  }
  get pending(): boolean {
    return !!this.origin
  }

  stop(): void {
    this.stopped = true
  }

  async permit(destination: string): Promise<boolean> {
    if (!this.active || !this.origin || secureOrigin(destination) !== destination) return false
    if (destination === this.origin) return true
    // An SSO chain can have multiple providers, each independently approved in native UI.
    if (!this.providers.has(destination)) {
      if (this.providers.size >= 8) return false
      const origin = this.origin
      this.providers.set(
        destination,
        this.approval.provider(origin, destination).catch(() => false),
      )
    }
    return (await this.providers.get(destination)!) && this.active
  }

  async run(page: Page, work: () => Promise<void>, returnOrigin?: string): Promise<boolean> {
    const initial = page.url()
    const initialOrigin = secureOrigin(initial)
    const origin = returnOrigin ?? initialOrigin
    if (!origin || this.pending || this.stopped || !(await this.approval.begin(origin))) return false
    if (!initialOrigin || page.url() !== initial || this.stopped) return false
    this.origin = origin
    this.deadline = this.now() + 240000
    this.providers.clear()
    try {
      if (!(await this.permit(initialOrigin))) return false
      await page.bringToFront()
      await work()
      // Completing this dialog authorizes resuming the task, not proof of a successful login.
      const completed = await this.approval.finish(origin)
      return completed && this.active && secureOrigin(page.url()) === origin
    } finally {
      this.origin = undefined
      this.providers.clear()
    }
  }
}
