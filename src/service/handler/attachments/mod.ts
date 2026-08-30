/**
 * Where a file dropped or pasted into a document goes (CLP-16). A day
 * document's files join that day's attachments (`attachments/YYYY/MM/DD/`
 * under the user-data directory) and are recorded in its `attachments:`
 * frontmatter; any other document's files sit in the user-data mirror of its
 * directory — `library/guides/` for `library/guides/x.md`. The document links a
 * file by bare name, and the file route looks it up in the same two places.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { copyFileDedup } from '#lib/notebook/attachments.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'

export interface AttachmentDestination {
  /** The directory the copy lands in, absolute */
  dir: string
  /** The day whose attachments hold it — set for day documents only */
  day?: string
}

export interface StoreAttachmentInput {
  userDataDir: string
  /** The document's notebook-relative path */
  relativePath: string
  /** The name the file arrived with */
  name: string
  data: Uint8Array
}

export interface StoredAttachment {
  /** The name the copy carries — the original, or `_2`-suffixed when a different file holds it */
  file: string
  /** The day whose attachments hold it — set for day documents only */
  day?: string
}

/** The directory the files of a document (or of a file beside it) belong in. */
export function attachmentDestination(relativePath: string, userDataDir: string): AttachmentDestination {
  const time = parseTimePath(relativePath)
  if (time?.kind === 'day') {
    return { dir: path.join(userDataDir, 'attachments', dayAttachmentsDir(time.date)), day: time.date.toString() }
  }
  return { dir: path.join(userDataDir, path.dirname(relativePath)) }
}

/**
 * Where a file named beside a document may be, in lookup order: the mirror of
 * the document's directory, then — for a day document — the day's attachments.
 */
export function attachmentCandidates(fileRelativePath: string, userDataDir: string): string[] {
  const destination = attachmentDestination(fileRelativePath, userDataDir)
  const candidates = [path.join(userDataDir, fileRelativePath)]
  if (destination.day) candidates.push(path.join(destination.dir, path.basename(fileRelativePath)))
  return candidates
}

/** A file name fit for the notebook: the last path segment, no control characters, not hidden. */
export function safeAttachmentName(name: string): string {
  const base = name.replaceAll('\\', '/').split('/').pop()?.trim() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f:]/g, '-').replace(/^\.+/, '')
  return cleaned.length > 0 ? cleaned : 'file'
}

/**
 * Copies the bytes into the document's attachment directory, deduplicated by
 * content: the same file arriving twice keeps one copy and one name; a
 * different file wanting the same name gets `_2`.
 */
export async function storeAttachment(input: StoreAttachmentInput): Promise<StoredAttachment> {
  const destination = attachmentDestination(input.relativePath, input.userDataDir)
  const stagingDir = path.join(input.userDataDir, 'tmp')
  await mkdir(destination.dir, { recursive: true })
  await mkdir(stagingDir, { recursive: true })
  const staging = path.join(stagingDir, `attach-${randomUUID()}`)
  try {
    await writeFile(staging, input.data)
    const file = await copyFileDedup(staging, destination.dir, safeAttachmentName(input.name))
    if (!file) throw new Error('The file could not be staged')
    return destination.day ? { file, day: destination.day } : { file }
  } finally {
    await rm(staging, { force: true })
  }
}
