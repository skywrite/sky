/**
 * The files Sky may edit without asking — one ledger for every chat on
 * every host. A person's go on a file-scoped tool call and a file a tool
 * created both land here, and the approval policy reads it on every miss,
 * so a go given in a terminal chat covers the web thread that starts next.
 *
 * One JSON map, file id → grant, pretty-printed newest first so the file
 * reads as the record it is. A write rewrites the whole file under a
 * process lock with an atomic rename; a read re-checks the file's stamp,
 * so a grant another process wrote is seen without a watcher. Deleting a
 * key revokes the grant. A key is a grant whatever its value holds, so a
 * hand-edited entry never loses its standing.
 * See service/handler/chat/docs/2026-10-08-one-go-stands-for-every-chat.md.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { missing, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { DIR_TMP_SYS } from '#shared/config.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export interface FileGrant {
  /** When the go was given */
  at: string
  /** How: the person allowed a call on the file, or a tool created it */
  via: 'allowed' | 'created'
  /** Where it came from — the chat, as its host names it */
  source?: string
  /** What the file is, as a tool last reported it */
  title?: string
  kind?: string
  url?: string
}

/** What a caller knows when it grants. `at` defaults to now. */
export type FileGrantInput = Partial<FileGrant> & Pick<FileGrant, 'via'>

/** What a tool reports about a file: fills the blanks of a grant, never makes one. */
export type FileGrantDetails = Pick<FileGrant, 'title' | 'kind' | 'url'>

/** The ledger could not be read as a map of grants. The file is left as it is. */
export class FileGrantsError extends Error {}

type Ledger = Record<string, unknown>

export class FileGrants {
  private cache?: { stamp: string; grants: Ledger }
  private readonly lockDir: string

  constructor(readonly file: string) {
    // The ledger may sync between machines; its lock must not.
    const key = createHash('sha256').update(file).digest('hex').slice(0, 16)
    this.lockDir = path.join(DIR_TMP_SYS, 'sky-locks', `file-grants-${key}`)
  }

  /** Whether the file is granted: its key is in the ledger. */
  async has(fileId: string): Promise<boolean> {
    return Object.hasOwn(await this.load(), fileId)
  }

  /** The grant as recorded, when it is well formed. */
  async get(fileId: string): Promise<FileGrant | undefined> {
    return asGrant((await this.load())[fileId])
  }

  /** Every well-formed grant by file id, newest first as the file holds them. */
  async all(): Promise<Record<string, FileGrant>> {
    const grants: Record<string, FileGrant> = {}
    for (const [id, value] of Object.entries(await this.load())) {
      const grant = asGrant(value)
      if (grant) grants[id] = grant
    }
    return grants
  }

  /**
   * Record a go for a file. The first grant is the record; a later one only
   * fills what it left blank — a tool naming the file the person allowed
   * before it ran.
   */
  async grant(fileId: string, input: FileGrantInput): Promise<void> {
    await this.write((grants) => {
      const held = grants[fileId]
      grants[fileId] = tidy(
        isRecord(held)
          ? { ...details(input), ...held }
          : { at: input.at ?? ZonedDateTime.now().toString(), via: input.via, ...details(input) },
      )
    })
  }

  /** What a tool reported about a granted file. A file with no grant stays as it is. */
  async describe(fileId: string, input: FileGrantDetails): Promise<void> {
    if (!(await this.has(fileId))) return
    await this.write((grants) => {
      const held = grants[fileId]
      if (isRecord(held)) grants[fileId] = tidy({ ...details(input), ...held })
    })
  }

  private async write(mutate: (grants: Ledger) => void): Promise<void> {
    await withProcessLock(this.lockDir, async () => {
      // Fresh under the lock: another process may have written since the last read.
      const grants = await this.read()
      mutate(grants)
      const ordered = Object.fromEntries(
        Object.entries(grants).sort(([, a], [, b]) => (asGrant(b)?.at ?? '').localeCompare(asGrant(a)?.at ?? '')),
      )
      await writeJson(this.file, ordered, 2)
      this.cache = { stamp: await this.stamp(), grants: ordered }
    })
  }

  /** The ledger as last read, read again when the file changed underneath. A file that cannot be read grants nothing. */
  private async load(): Promise<Ledger> {
    const stamp = await this.stamp()
    if (this.cache?.stamp === stamp) return this.cache.grants
    let grants: Ledger
    try {
      grants = await this.read()
    } catch (error) {
      if (error instanceof FileGrantsError) return {}
      throw error
    }
    this.cache = { stamp, grants }
    return grants
  }

  private async stamp(): Promise<string> {
    try {
      const { ino, mtimeMs, size } = await stat(this.file)
      return `${ino}:${mtimeMs}:${size}`
    } catch (error) {
      if (missing(error)) return 'none'
      throw error
    }
  }

  /** The file as it is: a JSON object keyed by file id, or nothing. Anything else is said, never read as empty. */
  private async read(): Promise<Ledger> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if (missing(error)) return {}
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FileGrantsError(`The file grants ledger is not valid JSON: ${this.file}. Fix it or remove it.`)
    }
    if (!isRecord(parsed))
      throw new FileGrantsError(`The file grants ledger is not a map of file ids: ${this.file}. Fix it or remove it.`)
    return parsed
  }
}

const isRecord = (value: unknown): value is Ledger => !!value && typeof value === 'object' && !Array.isArray(value)

function asGrant(value: unknown): FileGrant | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.at !== 'string' || (value.via !== 'allowed' && value.via !== 'created')) return undefined
  return tidy({ at: value.at, via: value.via, ...details(value as Partial<FileGrant>) }) as unknown as FileGrant
}

/** The optional strings a caller supplied, blanks dropped. */
function details(input: Partial<FileGrant>): Partial<FileGrant> {
  const picked: Partial<FileGrant> = {}
  for (const key of ['source', 'title', 'kind', 'url'] as const) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) picked[key] = value
  }
  return picked
}

/** Keys in reading order: when, how, where, what — then anything a hand added, as it was. */
function tidy(record: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {}
  for (const key of ['at', 'via', 'source', 'title', 'kind', 'url']) {
    if (record[key] !== undefined) ordered[key] = record[key]
  }
  for (const [key, value] of Object.entries(record)) {
    if (!(key in ordered)) ordered[key] = value
  }
  return ordered
}
