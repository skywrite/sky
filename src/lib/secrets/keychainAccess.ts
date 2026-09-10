import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runKeychainProcess } from './keychainProcess.ts'
import { KeychainAccessError, type KeychainRequest } from './keychainProtocol.ts'

interface Cached {
  value?: string | null
  error?: KeychainAccessError
  until: number
}

/** Shared by every provider instance, including the settings page and background jobs. */
export class KeychainAccess {
  private queue: Promise<unknown> = Promise.resolve()
  private pending = new Map<string, Promise<string | null>>()
  private cache = new Map<string, Cached>()
  private generation = new Map<string, number>()
  private revision = ''
  private readonly stateDir: string
  private readonly run: typeof runKeychainProcess
  private readonly now: () => number
  private readonly readRevision: () => Promise<string>

  constructor(
    stateDir: string,
    run = runKeychainProcess,
    now = () => performance.now(),
    readRevision = () => readFile(path.join(stateDir, 'revision.json'), 'utf8').catch(() => ''),
  ) {
    this.stateDir = stateDir
    this.run = run
    this.now = now
    this.readRevision = readRevision
  }

  private key(service: string, account: string): string {
    return JSON.stringify([service, account])
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => {})
    return result
  }

  get(service: string, account: string, interactive = false): Promise<string | null> {
    const key = this.key(service, account)
    const pending = this.pending.get(key)
    if (pending && !interactive) return pending
    const generation = this.generation.get(key) ?? 0
    const result = this.serialize(async () => {
      const revision = await this.readRevision()
      if (revision !== this.revision) {
        this.cache.clear()
        this.revision = revision
      }
      const cached = this.cache.get(key)
      if (!interactive && cached && cached.until > this.now()) {
        if (cached.error) throw cached.error
        return cached.value ?? null
      }
      try {
        const value = await this.run({ operation: 'get', service, account, interactive, stateDir: this.stateDir })
        const after = await this.readRevision()
        if (after !== this.revision) this.cache.clear()
        this.revision = after
        if ((this.generation.get(key) ?? 0) === generation && (interactive || revision === after)) {
          this.cache.set(key, { value, until: this.now() + (value === null ? 5_000 : 300_000) })
        }
        return value
      } catch (err) {
        if (err instanceof KeychainAccessError && (this.generation.get(key) ?? 0) === generation) {
          this.cache.set(key, {
            error: err,
            until: this.now() + (err.kind === 'access' ? 300_000 : err.retryAfterMs || 30_000),
          })
        }
        throw err
      }
    })
    this.pending.set(key, result)
    const clear = () => {
      if (this.pending.get(key) === result) this.pending.delete(key)
    }
    void result.then(clear, clear)
    return result
  }

  mutate(
    operation: 'set' | 'delete',
    service: string,
    account: string,
    value?: string,
    interactive = false,
  ): Promise<void> {
    const key = this.key(service, account)
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1)
    this.cache.delete(key)
    this.pending.delete(key)
    return this.serialize(async () => {
      const request: KeychainRequest = { operation, service, account, value, interactive, stateDir: this.stateDir }
      await this.run(request)
      this.cache.clear()
      this.revision = await this.readRevision()
      this.cache.set(key, {
        value: operation === 'set' ? value : null,
        until: this.now() + (operation === 'set' ? 300_000 : 5_000),
      })
    })
  }
}
