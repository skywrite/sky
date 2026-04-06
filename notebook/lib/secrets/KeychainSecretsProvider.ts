import * as path from 'node:path'
import { deletePassword, getPassword, setPassword } from 'cross-keychain'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import { DIR_BASE } from '#config'
import { parse as parseYaml, stringify as stringifyYaml } from '#shared/yaml/mod.ts'
import type { SecretsProvider } from './SecretsProvider.ts'
import type { EntityType, IndexEntry, SecretEntry } from './types.ts'
import { createSecret, marshal, unmarshal } from './marshal.ts'

const SERVICE_PREFIX = 'sky'
const INDEX_PATH = path.join(DIR_BASE, 'secrets', 'index.yaml')

/**
 * SecretsProvider backed by the OS keychain (macOS Keychain, Windows Credential Manager,
 * Linux Secret Service) via cross-keychain.
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
  async get(category: string, name: string): Promise<SecretEntry | null> {
    const raw = await getPassword(`${SERVICE_PREFIX}-${category}`, name)
    if (raw === null) return null
    try {
      return unmarshal(raw)
    } catch {
      // Legacy plain string — wrap as secret type
      return createSecret(raw)
    }
  }

  async set(category: string, name: string, entry: SecretEntry): Promise<void> {
    await setPassword(`${SERVICE_PREFIX}-${category}`, name, marshal(entry))
    await addToIndex(category, name, entry.type)
  }

  async delete(category: string, name: string): Promise<void> {
    try {
      await deletePassword(`${SERVICE_PREFIX}-${category}`, name)
    } catch {
      // Ignore if not found
    }
    await removeFromIndex(category, name)
  }

  async list(category?: string): Promise<IndexEntry[]> {
    const entries = await readIndex()
    if (category) return entries.filter((e) => e.category === category)
    return entries
  }
}

// ── Index file management ──────────────────────────────────────────────

async function readIndex(): Promise<IndexEntry[]> {
  try {
    const content = await readTextFile(INDEX_PATH)
    const parsed = parseYaml(content) as IndexEntry[] | null
    if (!Array.isArray(parsed)) return []
    // Handle legacy entries missing type field
    return parsed.map((e) => ({ category: e.category, name: e.name, type: e.type ?? ('secret' as EntityType) }))
  } catch {
    return []
  }
}

async function writeIndex(entries: IndexEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
  )
  const content = sorted.length > 0 ? stringifyYaml(sorted) : ''
  await outputFile(INDEX_PATH, content)
}

async function addToIndex(category: string, name: string, type: EntityType): Promise<void> {
  const entries = await readIndex()
  const idx = entries.findIndex((e) => e.category === category && e.name === name)
  if (idx >= 0) {
    entries[idx].type = type
  } else {
    entries.push({ category, name, type })
  }
  await writeIndex(entries)
}

async function removeFromIndex(category: string, name: string): Promise<void> {
  const entries = await readIndex()
  const filtered = entries.filter((e) => !(e.category === category && e.name === name))
  if (filtered.length !== entries.length) {
    await writeIndex(filtered)
  }
}
