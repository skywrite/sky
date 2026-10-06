import { CredentialError } from '#lib/credentials/errors.ts'
import { SignInBroker, type LoginProvider, type LoginSource, type SignInBrokerOptions } from './broker.ts'

type SessionProvider = LoginProvider & { setExcludedVaultIds(ids: readonly string[]): void }

/** Lives only in the private worker. Reuse SDK clients, never password values or persisted grants. */
export class CredentialRun {
  private approved?: Promise<boolean>
  private ended = false
  private readonly providers = new Map<string, { account: string; provider: SessionProvider }>()

  constructor(
    private readonly options: Omit<SignInBrokerOptions, 'connect'> & {
      connect(source: LoginSource): Promise<SessionProvider>
      signal: AbortSignal
    },
  ) {
    options.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  close(): void {
    this.ended = true
    this.approved = undefined
    this.providers.clear()
  }

  broker(): SignInBroker {
    const active = () => !this.ended && !this.options.signal.aborted
    return new SignInBroker({
      sources: async () => {
        if (!active()) return []
        const sources = await this.options.sources()
        for (const [id, cached] of this.providers) {
          if (!sources.some((source) => source.id === id && source.account === cached.account))
            this.providers.delete(id)
        }
        return sources
      },
      connect: async (source) => {
        if (!active() || !(await this.approved)) throw new CredentialError('access-required')
        let cached = this.providers.get(source.id)
        if (!cached || cached.account !== source.account) {
          const provider = await this.options.connect(source)
          if (!active()) throw new CredentialError('access-required')
          cached = { account: source.account, provider }
          this.providers.set(source.id, cached)
        }
        cached.provider.setExcludedVaultIds(source.excludedVaultIds)
        return cached.provider
      },
      approval: {
        allowLookup: async (origin) => {
          if (!active()) return false
          this.approved ??= this.options.approval.allowLookup(origin)
          return (await this.approved) && active()
        },
        choose: async (origin, choices, context) => {
          if (!active() || !(await this.approved)) return null
          // A partial listing cannot prove that a lone result is unambiguous.
          const selected =
            choices.length === 1 && !context?.incomplete
              ? 0
              : await this.options.approval.choose(origin, choices, context)
          return active() ? selected : null
        },
      },
    })
  }
}
