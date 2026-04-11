import type { IndexEntry, SecretEntry } from './types.ts'

export interface SecretsProvider {
  /** Get a typed secret entry. Returns null if not found. */
  get(category: string, name: string): Promise<SecretEntry | null>

  /** Store a typed secret entry. Overwrites if exists. */
  set(category: string, name: string, entry: SecretEntry): Promise<void>

  /** Delete a secret. No-op if not found. */
  delete(category: string, name: string): Promise<void>

  /** List known secrets. Optionally filter by category. Returns metadata only, no values. */
  list(category?: string): Promise<IndexEntry[]>
}
