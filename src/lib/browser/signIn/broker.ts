import { matchesLoginOrigin, type LoginValues, secureOrigin } from '#lib/credentials/login.ts'
import type { CredentialContainer, CredentialListing, CredentialSummary, ItemRef } from '#lib/credentials/types.ts'

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

export interface SignInBrokerOptions {
  sources(): Promise<LoginSource[]>
  connect(source: LoginSource): Promise<LoginProvider>
  approval: SignInApproval
}

/** No persisted grants. Every call requires fresh, independent approval bound to this form. */
export class SignInBroker {
  private busy = false

  constructor(private readonly options: SignInBrokerOptions) {}

  async signIn(target: SignInTarget, signal?: AbortSignal): Promise<SignInResult> {
    if (this.busy) {
      await target.dispose()
      return { status: 'unavailable' }
    }
    this.busy = true
    const current = async () => !signal?.aborted && (await target.current())
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
      // Settings may have disconnected the account or excluded the vault during the native dialog.
      const stillIncluded = async () => {
        const saved = (await this.options.sources()).find((entry) => entry.id === source.id)
        return !!saved && saved.account === source.account && !saved.excludedVaultIds.includes(item.ref.containerId)
      }
      if (!(await stillIncluded())) return { status: 'needs_user' }
      const values = await provider.readLogin(item.ref, target.origin)
      if (!(await stillIncluded()) || !(await current())) return { status: 'needs_user' }
      return { status: await target.submit(values) }
    } catch {
      // Native/provider/browser exceptions may contain submitted values. Never serialize them.
      return { status: 'unavailable' }
    } finally {
      this.busy = false
      await target.dispose().catch(() => {})
    }
  }
}
