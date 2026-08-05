import { marshal, unmarshal } from './marshal.ts'
import type { SecretsProvider } from './SecretsProvider.ts'
import type { IndexEntry, SecretEntry } from './types.ts'

/**
 * In-memory SecretsProvider for tests.
 * No OS keychain interaction — just a Map.
 */
export class TestSecretsProvider implements SecretsProvider {
  private store = new Map<string, string>()

  constructor(initial?: Record<string, SecretEntry>) {
    if (initial) {
      for (const [key, entry] of Object.entries(initial)) {
        this.store.set(key, marshal(entry))
      }
    }
  }

  async get(category: string, name: string): Promise<SecretEntry | null> {
    const raw = this.store.get(`${category}/${name}`)
    if (!raw) return null
    return unmarshal(raw)
  }

  async set(category: string, name: string, entry: SecretEntry): Promise<void> {
    this.store.set(`${category}/${name}`, marshal(entry))
  }

  async delete(category: string, name: string): Promise<void> {
    this.store.delete(`${category}/${name}`)
  }

  async list(category?: string): Promise<IndexEntry[]> {
    const entries: IndexEntry[] = []
    for (const [key, raw] of this.store.entries()) {
      const [cat, ...rest] = key.split('/')
      const nm = rest.join('/')
      if (!category || cat === category) {
        const entry = unmarshal(raw)
        entries.push({ category: cat, name: nm, type: entry.type })
      }
    }
    return entries
  }
}
