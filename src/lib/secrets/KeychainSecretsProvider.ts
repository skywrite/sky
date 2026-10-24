import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, rmdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_BASE, DIR_STATE } from '#config'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import { parse as parseYaml, stringify as stringifyYaml } from '#shared/yaml/mod.ts'
import { KeychainAccess } from './keychainAccess.ts'
import { KeychainAccessError } from './keychainProtocol.ts'
import { createSecret, marshal, unmarshal } from './marshal.ts'
import type { SecretsProvider } from './SecretsProvider.ts'
import type { EntityType, IndexEntry, SecretEntry } from './types.ts'

const SERVICE_PREFIX = 'sky'
const INDEX_PATH = path.join(DIR_STATE, 'keychain', 'index.yaml')
const LEGACY_INDEX_PATH = path.join(DIR_BASE, 'secrets', 'index.yaml')
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
 * Maintains a lightweight index file at DIR_STATE/keychain/index.yaml to support listing
 * (the OS keychain APIs don't support enumeration reliably across platforms).
 * The index contains only (category, name, type) tuples — no secret values.
 */
export class KeychainSecretsProvider implements SecretsProvider {
  private readonly keychain: KeychainAccess
  private readonly indexPath: string
  private readonly legacyIndexPath?: string
  private indexReady?: Promise<void>

  constructor(
    keychain = access,
    indexPath = INDEX_PATH,
    legacyIndexPath = indexPath === INDEX_PATH ? LEGACY_INDEX_PATH : undefined,
  ) {
    this.keychain = keychain
    this.indexPath = indexPath
    this.legacyIndexPath = legacyIndexPath
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
    await this.initializeIndex()
    await this.keychain.mutate('set', `${SERVICE_PREFIX}-${category}`, name, marshal(entry))
    await this.updateIndex(() => addToIndex(category, name, entry.type, this.indexPath))
  }

  async delete(category: string, name: string): Promise<void> {
    await this.initializeIndex()
    await this.keychain.mutate('delete', `${SERVICE_PREFIX}-${category}`, name)
    await this.updateIndex(() => removeFromIndex(category, name, this.indexPath))
  }

  async list(category?: string): Promise<IndexEntry[]> {
    await this.initializeIndex()
    const entries = await readIndex(this.indexPath)
    if (category) return entries.filter((e) => e.category === category)
    return entries
  }

  /** Only called after an explicit Restore access action. Values never leave this provider. */
  async restoreAccess(category?: string): Promise<void> {
    const entries = await this.list(category)
    if (entries.length === 0) return
    await this.keychain.restore()
    const failures: unknown[] = []
    for (const entry of entries) {
      try {
        const service = `${SERVICE_PREFIX}-${entry.category}`
        const value = await this.keychain.get(service, entry.name, true)
        // Token refreshes also need write access. Authorize the unchanged value once,
        // here, rather than prompting later during a background refresh.
        if (value !== null) await this.keychain.mutate('set', service, entry.name, value, true)
      } catch (error) {
        if (error instanceof KeychainAccessError && error.status === -128) throw error
        // A denied entry must not prevent the remaining accounts from recovering.
        failures.push(error)
      }
    }
    if (failures.length > 0) throw failures[0]
  }

  private initializeIndex(): Promise<void> {
    return (this.indexReady ??= this.updateIndex(async () => {
      if (this.legacyIndexPath) await migrateIndex(this.legacyIndexPath, this.indexPath)
    }).catch((error: unknown) => {
      this.indexReady = undefined
      throw error
    }))
  }

  private updateIndex(work: () => Promise<void>): Promise<void> {
    const result = indexWrite.then(work, work)
    indexWrite = result.catch(() => {})
    return result
  }
}

// ── Index file management ──────────────────────────────────────────────

async function readOptionalIndex(file: string): Promise<Buffer | undefined> {
  try {
    if (!(await lstat(file)).isFile()) {
      throw new Error(
        `The Keychain index at ${file} must be a regular file. Migration stopped without removing the original.`,
      )
    }
    return await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function migrateIndex(legacyPath: string, indexPath: string): Promise<void> {
  if (path.resolve(legacyPath) === path.resolve(indexPath)) return
  const original = await readOptionalIndex(legacyPath)
  if (original === undefined) return

  await mkdir(path.dirname(indexPath), { recursive: true, mode: 0o700 })
  const temporary = `${indexPath}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(original)
    await handle.sync()
    await handle.close()
    // Publish a complete copy on the destination volume without overwriting an existing index.
    await link(temporary, indexPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    if (!(await readOptionalIndex(indexPath))?.equals(original)) {
      throw new Error(
        `The Keychain indexes at ${legacyPath} and ${indexPath} differ. Both were kept. Compare the files before retrying.`,
      )
    }
    const remaining = await readOptionalIndex(legacyPath)
    if (remaining && !remaining.equals(original)) {
      throw new Error(`The Keychain index at ${legacyPath} changed during migration. The original was kept. Try again.`)
    }
    await unlink(legacyPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await rmdir(path.dirname(legacyPath)).catch((error: unknown) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    })
  } finally {
    await handle.close()
    await unlink(temporary)
  }
}

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
