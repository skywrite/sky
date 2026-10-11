import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE } from '#config'
import { atomicWrite, hash, readOptional } from '#lib/outbox/files.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { GoogleClient } from './client.ts'
import { fetchDoc, summarizeDocument, summarizeDocTabTexts } from './docs.ts'
import type { DocOutline, DocTabText } from './docs.ts'
import { EXPORT_MIME, exportFile, getFile, workspaceKind } from './drive.ts'
import type { DriveFile } from './drive.ts'

type SnapshotDocument = Parameters<typeof summarizeDocument>[0] &
  Parameters<typeof summarizeDocTabTexts>[0] & {
    documentId?: string
    revisionId?: string
    suggestionsViewMode?: string
  }

interface SavedSnapshot {
  schema: 1
  account: string
  file: DriveFile & { version: string }
  capturedAt: string
  revisionFetchedAtMs: number
  document: SnapshotDocument
  markdown?: string
}

export interface DocSnapshot extends SavedSnapshot {
  outline: DocOutline
  tabs: DocTabText[]
}

interface ReadOptions {
  /** Metadata just fetched by the shared Workspace reader, never a saved copy. */
  file?: DriveFile
  forEditing?: boolean
  /** Outlines and tab reads need only the structured document. */
  includeMarkdown?: boolean
}

const MAX_CAPTURE_ATTEMPTS = 3
// Docs revision IDs are user-specific and guaranteed valid for only 24 hours.
// Drive versions keep the content reusable beyond that; renew the write token separately.
const REVISION_MAX_AGE_MS = 23 * 60 * 60 * 1000
const pending = new Map<string, Promise<DocSnapshot>>()

function derive(saved: SavedSnapshot): DocSnapshot {
  return { ...saved, outline: summarizeDocument(saved.document), tabs: summarizeDocTabTexts(saved.document) }
}

function sameAccess(a: DriveFile, b: DriveFile): boolean {
  return (
    a.capabilities?.canEdit === b.capabilities?.canEdit && a.capabilities?.canComment === b.capabilities?.canComment
  )
}

function parseSaved(text: string, account: string, file: DriveFile): SavedSnapshot | undefined {
  try {
    const saved = JSON.parse(text) as SavedSnapshot
    if (
      saved?.schema !== 1 ||
      saved.account !== account ||
      saved.file?.id !== file.id ||
      saved.file.version !== file.version ||
      !sameAccess(saved.file, file) ||
      (saved.markdown !== undefined && typeof saved.markdown !== 'string') ||
      typeof saved.capturedAt !== 'string' ||
      !Number.isFinite(saved.revisionFetchedAtMs) ||
      !saved.document ||
      typeof saved.document !== 'object' ||
      Array.isArray(saved.document) ||
      (saved.document.documentId !== undefined && saved.document.documentId !== file.id) ||
      !Array.isArray(saved.document.tabs)
    )
      return undefined
    // Derivation also validates the tree enough to discard malformed cache files.
    derive(saved)
    return saved
  } catch {
    return undefined
  }
}

/**
 * Rebuildable, account-scoped document sidecars. Every read checks Drive first,
 * including access: a saved copy is never a fallback for a failed remote check.
 * One atomic JSON file keeps text, structure and their version inseparable.
 */
export class DocSnapshotStore {
  constructor(readonly root = path.join(DIR_STATE, 'google', 'docs')) {}

  filePath(account: string, fileId: string): string {
    // These are cache keys for provider IDs, not new user-content IDs. Hashing
    // also preserves distinct, case-sensitive Drive IDs on case-insensitive disks.
    return path.join(this.root, hash(account.toLowerCase()), hash(fileId), 'snapshot.json')
  }

  async read(client: GoogleClient, fileId: string, options: ReadOptions = {}): Promise<DocSnapshot> {
    const file = options.file ?? (await getFile(client, fileId))
    if (file.id !== fileId || workspaceKind(file.mimeType) !== 'doc') {
      throw new Error(`"${file.name}" is not the requested Google Doc (${fileId})`)
    }
    if (!file.version) {
      throw new Error(`Google did not return a version for "${file.name}"; its snapshot could not be checked`)
    }
    const target = this.filePath(client.email, fileId)
    // The metadata check stays outside coalescing, so each caller proves access
    // and a caller observing a newer version cannot join an older in-flight read.
    const key = `${target}\0${file.version}\0${file.capabilities?.canEdit}\0${file.capabilities?.canComment}\0${options.forEditing === true}\0${options.includeMarkdown !== false}`
    const existing = pending.get(key)
    if (existing) return existing
    const run = this.load(client, file, target, options.forEditing === true, options.includeMarkdown !== false)
    pending.set(key, run)
    try {
      return await run
    } finally {
      if (pending.get(key) === run) pending.delete(key)
    }
  }

  private async load(
    client: GoogleClient,
    file: DriveFile,
    target: string,
    forEditing: boolean,
    includeMarkdown: boolean,
  ): Promise<DocSnapshot> {
    // A missing, damaged or inaccessible cache must not stop an authenticated live read.
    const text = await readOptional(target).catch(() => undefined)
    const saved = text ? parseSaved(text, client.email.toLowerCase(), file) : undefined
    if (saved) {
      const age = ZonedDateTime.now().epochMilliseconds - saved.revisionFetchedAtMs
      const renewRevision =
        forEditing &&
        file.capabilities?.canEdit !== false &&
        (!saved.document.revisionId || age < 0 || age >= REVISION_MAX_AGE_MS)
      const exportMarkdown = includeMarkdown && saved.markdown === undefined
      // A preview's indexes cannot be paired with an inline edit token. Refresh
      // the whole structure when upgrading access; renew tokens only for inline trees.
      if (!renewRevision || saved.document.suggestionsViewMode === 'SUGGESTIONS_INLINE') {
        if (!exportMarkdown && !renewRevision)
          return derive({ ...saved, file: { ...file, version: saved.file.version } })
        const [markdown, current] = await Promise.all([
          exportMarkdown ? exportFile(client, file.id, EXPORT_MIME.doc) : Promise.resolve(saved.markdown),
          renewRevision
            ? fetchDoc<{ revisionId?: string; suggestionsViewMode?: string }>(
                client,
                file.id,
                'revisionId,suggestionsViewMode',
              )
            : Promise.resolve(saved.document),
        ])
        const after = await getFile(client, file.id)
        if (
          after.version === saved.file.version &&
          sameAccess(file, after) &&
          (!renewRevision || current.suggestionsViewMode === 'SUGGESTIONS_INLINE')
        ) {
          const renewed: SavedSnapshot = {
            ...saved,
            file: { ...after, version: saved.file.version },
            document: { ...saved.document, revisionId: current.revisionId },
            markdown,
            revisionFetchedAtMs: renewRevision ? ZonedDateTime.now().epochMilliseconds : saved.revisionFetchedAtMs,
          }
          await this.save(target, renewed)
          return derive(renewed)
        }
        file = after
      }
    }

    for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
      const [document, markdown] = await Promise.all([
        // Let Google select the permitted suggestions view for read-only accounts.
        fetchDoc<SnapshotDocument>(client, file.id, 'documentId,title,revisionId,suggestionsViewMode,tabs'),
        includeMarkdown ? exportFile(client, file.id, EXPORT_MIME.doc) : Promise.resolve(undefined),
      ])
      const after = await getFile(client, file.id)
      if (file.version && after.version === file.version && sameAccess(file, after)) {
        const now = ZonedDateTime.now()
        const snapshot: SavedSnapshot = {
          schema: 1,
          account: client.email.toLowerCase(),
          file: { ...after, version: file.version },
          capturedAt: now.toString(),
          revisionFetchedAtMs: now.epochMilliseconds,
          document,
          markdown,
        }
        const result = derive(snapshot)
        await this.save(target, snapshot)
        return result
      }
      file = after
    }
    throw new Error(
      `"${file.name}" kept changing while it was being read. No snapshot was saved; read it again before editing.`,
    )
  }

  private async save(target: string, snapshot: SavedSnapshot): Promise<void> {
    // Persistence is an optimization. A disk failure must not discard a valid live read.
    await atomicWrite(target, JSON.stringify(snapshot)).catch(() => undefined)
  }

  async invalidate(client: GoogleClient, fileId: string): Promise<void> {
    // Even if deletion fails or an older concurrent capture finishes afterward,
    // the next reader checks Drive's version before reusing anything on disk.
    await unlink(this.filePath(client.email, fileId)).catch(() => undefined)
  }
}

export const docSnapshots = new DocSnapshotStore()
