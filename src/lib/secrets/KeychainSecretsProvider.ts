import * as path from 'node:path'
import { DIR_BASE, DIR_STATE } from '#config'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import { parse as parseYaml, stringify as stringifyYaml } from '#shared/yaml/mod.ts'
import { KeychainAccess } from './keychainAccess.ts'
import { createSecret, marshal, unmarshal } from './marshal.ts'
import type { SecretsProvider } from './SecretsProvider.ts'
import type { EntityType, IndexEntry, SecretEntry } from './types.ts'

const SERVICE_PREFIX = 'sky'
const INDEX_PATH = path.join(DIR_BASE, 'secrets', 'index.yaml')
const access = new KeychainAccess(path.join(DIR_STATE, 'keychain'))
let indexWrite: Promise<unknown> = Promise.resolve()

/**
 * SecretsProvider backed by the OS keychain (macOS Keychain, Windows Credential Manager,
 * Linux Secret Service). OS calls run in a bounded child process; background
 * macOS access never presents authentication UI. See docs/README.md.
 *
 * Maps (category, name) → cross-keychain (service, account):
 *   service = "sky-{category}"  (e.g. "sky-gmail")
 *   account = name              (e.g. "personal")
 *
 * Values are stored as terse JSON blobs (see marshal.ts).
 *
 * Maintains a lightweight index file at SKY_DIR/secrets/index.yaml to support listing
 * (the OS keychain APIs don't support enumeration reliably across platforms).
 * The index contains only (category, name, type) tuples — no secret values.
 */
export class KeychainSecretsProvider implements SecretsProvider {
  private readonly keychain: KeychainAccess
  private readonly indexPath: string

  constructor(keychain = access, indexPath = INDEX_PATH) {
    this.keychain = keychain
    this.indexPath = indexPath
  }

  async get(category: string, name: string): Promise<SecretEntry | null> {
    const raw = await this.keychain.get(`${SERVICE_PREFIX}-${category}`, name)
    if (raw === null) return null
    try {
      return unmarshal(raw)
    } catch {
      // Legacy plain string — wrap as secret type
      return createSecret(raw)
    }
  }

  async set(category: string, name: string, entry: SecretEntry): Promise<void> {
    await this.keychain.mutate('set', `${SERVICE_PREFIX}-${category}`, name, marshal(entry))
    await this.updateIndex(() => addToIndex(category, name, entry.type, this.indexPath))
  }

  async delete(category: string, name: string): Promise<void> {
    await this.keychain.mutate('delete', `${SERVICE_PREFIX}-${category}`, name)
    await this.updateIndex(() => removeFromIndex(category, name, this.indexPath))
  }

  async list(category?: string): Promise<IndexEntry[]> {
    const entries = await readIndex(this.indexPath)
    if (category) return entries.filter((e) => e.category === category)
    return entries
  }

  /** Only called after an explicit Restore access action. Values never leave this provider. */
  async restoreAccess(category?: string): Promise<void> {
    for (const entry of await this.list(category)) {
      const service = `${SERVICE_PREFIX}-${entry.category}`
      const value = await this.keychain.get(service, entry.name, true)
      // Token refreshes also need write access. Authorize the unchanged value once,
      // here, rather than prompting later during a background refresh.
      if (value !== null) await this.keychain.mutate('set', service, entry.name, value, true)
    }
  }

  private updateIndex(work: () => Promise<void>): Promise<void> {
    const result = indexWrite.then(work, work)
    indexWrite = result.catch(() => {})
    return result
  }
}

// ── Index file management ──────────────────────────────────────────────

async function readIndex(indexPath: string): Promise<IndexEntry[]> {
  try {
    const content = await readTextFile(indexPath)
    const parsed = parseYaml(content) as IndexEntry[] | null
    if (!Array.isArray(parsed)) return []
    // Handle legacy entries missing type field
    return parsed.map((e) => ({ category: e.category, name: e.name, type: e.type ?? ('secret' as EntityType) }))
  } catch {
    return []
  }
}

async function writeIndex(entries: IndexEntry[], indexPath: string): Promise<void> {
  const sorted = [...entries].sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
  )
  const content = sorted.length > 0 ? stringifyYaml(sorted) : ''
  await outputFile(indexPath, content)
}

async function addToIndex(category: string, name: string, type: EntityType, indexPath: string): Promise<void> {
  const entries = await readIndex(indexPath)
  const idx = entries.findIndex((e) => e.category === category && e.name === name)
  if (idx >= 0) {
    entries[idx].type = type
  } else {
    entries.push({ category, name, type })
  }
  await writeIndex(entries, indexPath)
}

async function removeFromIndex(category: string, name: string, indexPath: string): Promise<void> {
  const entries = await readIndex(indexPath)
  const filtered = entries.filter((e) => !(e.category === category && e.name === name))
  if (filtered.length !== entries.length) {
    await writeIndex(filtered, indexPath)
  }
}
