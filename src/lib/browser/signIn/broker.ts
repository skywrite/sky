import { matchesLoginOrigin, type LoginOtp, type LoginValues, secureOrigin } from '#lib/credentials/login.ts'
import type {
  CredentialContainer,
  CredentialListing,
  CredentialSummary,
  ItemRef,
  OtpCode,
} from '#lib/credentials/types.ts'
import { Instant, instantNow } from '#universal/dates/nbdt/mod.ts'

export type SignInStatus = 'submitted' | 'needs_user' | 'declined' | 'unavailable'
export interface SignInResult {
  status: SignInStatus
}

export interface LoginSource {
  id: string
  account: string
  label: string
  excludedVaultIds: string[]
  containers?: CredentialContainer[]
}

export interface LoginProvider {
  list(): Promise<CredentialListing>
  readLogin(ref: ItemRef, origin: string): Promise<LoginValues>
  readLoginOtp?(ref: ItemRef, origin: string, binding: LoginOtp): Promise<OtpCode>
}

export interface LoginChoice {
  title: string
  account: string
  vault: string
}

/** Implemented by trusted native UI, never by a model tool or a Settings HTTP response. */
export interface SignInApproval {
  allowLookup(origin: string): Promise<boolean>
  choose(origin: string, choices: readonly LoginChoice[]): Promise<number | null>
}

/** A concrete document and form captured by the private browser, not model-supplied selectors. */
export interface SignInTarget {
  origin: string
  current(): Promise<boolean>
  submit(values: LoginValues): Promise<SignInStatus>
  dispose(): Promise<void>
}

export interface VerificationTarget extends Pick<SignInTarget, 'origin' | 'current' | 'dispose'> {
  submit(otp: OtpCode, authorized: () => Promise<boolean>): Promise<SignInStatus>
}

export interface SignInBrokerOptions {
  sources(): Promise<LoginSource[]>
  connect(source: LoginSource): Promise<LoginProvider>
  approval: SignInApproval
  /** Monotonic clock; supplied only by trusted tests, never by a tool or the worker protocol. */
  now?: () => number
}

interface PendingVerification {
  origin: string
  deadline: number
  included(): Promise<boolean>
  read(): Promise<OtpCode>
}

/** Native approval covers one password submission and its immediate, single-use TOTP continuation. */
export class SignInBroker {
  private busy = false
  private generation = 0
  private verification: PendingVerification | undefined

  constructor(private readonly options: SignInBrokerOptions) {}

  private now(): number {
    return this.options.now?.() ?? performance.now()
  }

  revoke(): void {
    this.verification = undefined
    this.generation++
  }

  async verify(target: VerificationTarget, signal?: AbortSignal): Promise<SignInResult> {
    if (this.busy) {
      await target.dispose()
      return { status: 'unavailable' }
    }
    const grant = this.verification
    // Consume before any await: errors, cancellation and rejected codes must not trigger retries.
    this.verification = undefined
    this.busy = true
    const generation = this.generation
    let expiresAt: number | undefined
    const fresh = () => expiresAt === undefined || expiresAt > Instant.from(instantNow()).epochMilliseconds + 5000
    const current = async () =>
      !!grant &&
      !signal?.aborted &&
      generation === this.generation &&
      this.now() < grant.deadline &&
      secureOrigin(target.origin) === grant.origin &&
      target.origin === grant.origin &&
      (await grant.included()) &&
      (await target.current()) &&
      !signal?.aborted &&
      generation === this.generation &&
      this.now() < grant.deadline &&
      fresh()
    try {
      if (!grant || !(await current())) return { status: 'needs_user' }
      const otp = await grant.read()
      if (otp.expiresAt) expiresAt = Instant.from(otp.expiresAt).epochMilliseconds
      if (!(await current())) return { status: 'needs_user' }
      // Only numeric authenticator codes are supported. Never put an OTP seed or recovery key in a field.
      if (!otp.code.use((value) => /^\d{6,8}$/.test(value))) return { status: 'needs_user' }
      return { status: await target.submit(otp, current) }
    } catch {
      return { status: 'unavailable' }
    } finally {
      this.busy = false
      await target.dispose().catch(() => {})
    }
  }

  async signIn(target: SignInTarget, signal?: AbortSignal): Promise<SignInResult> {
    if (this.busy) {
      await target.dispose()
      return { status: 'unavailable' }
    }
    this.busy = true
    this.revoke()
    const generation = this.generation
    const current = async () => !signal?.aborted && generation === this.generation && (await target.current())
    try {
      if (secureOrigin(target.origin) !== target.origin || !(await current())) return { status: 'needs_user' }
      const sources = await this.options.sources()
      if (!sources.length) return { status: 'needs_user' }
      if (!(await this.options.approval.allowLookup(target.origin))) return { status: 'declined' }
      if (!(await current())) return { status: 'needs_user' }
      const candidates: { source: LoginSource; provider: LoginProvider; item: CredentialSummary }[] = []
      let incomplete = false
      for (const source of sources) {
        if (!(await current())) return { status: 'needs_user' }
        try {
          const provider = await this.options.connect(source)
          const listed = await provider.list()
          incomplete ||= listed.issues.length > 0
          for (const item of listed.items) {
            if (
              item.ref.connectionId === source.id &&
              !source.excludedVaultIds.includes(item.ref.containerId) &&
              matchesLoginOrigin(item, target.origin)
            )
              candidates.push({ source, provider, item })
          }
        } catch {
          incomplete = true
        }
      }
      if (!candidates.length) return { status: incomplete ? 'unavailable' : 'needs_user' }
      if (candidates.length > 100 || !(await current())) return { status: 'needs_user' }
      const selected = await this.options.approval.choose(
        target.origin,
        candidates.map(({ source, item }) => ({
          title: item.title,
          account: source.label,
          vault: source.containers?.find((vault) => vault.id === item.ref.containerId)?.label ?? item.ref.containerId,
        })),
      )
      if (selected === null) return { status: 'declined' }
      if (!Number.isInteger(selected) || !candidates[selected] || !(await current())) return { status: 'needs_user' }
      const { source, provider, item } = candidates[selected]
      const { id, account } = source
      const ref = { ...item.ref }
      // Settings may have disconnected the account or excluded the vault during the native dialog.
      const stillIncluded = async () => {
        const saved = (await this.options.sources()).find((entry) => entry.id === id)
        return !!saved && saved.account === account && !saved.excludedVaultIds.includes(ref.containerId)
      }
      if (!(await stillIncluded())) return { status: 'needs_user' }
      const values = await provider.readLogin(ref, target.origin)
      if (!(await stillIncluded()) || !(await current())) return { status: 'needs_user' }
      const status = await target.submit(values)
      if (
        status === 'submitted' &&
        values.otp &&
        provider.readLoginOtp &&
        !signal?.aborted &&
        generation === this.generation
      ) {
        const binding = structuredClone(values.otp)
        const origin = target.origin
        this.verification = {
          origin,
          deadline: this.now() + 120_000,
          included: stillIncluded,
          read: () => provider.readLoginOtp!(ref, origin, binding),
        }
      }
      return { status }
    } catch {
      // Native/provider/browser exceptions may contain submitted values. Never serialize them.
      return { status: 'unavailable' }
    } finally {
      this.busy = false
      await target.dispose().catch(() => {})
    }
  }
}
