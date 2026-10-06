/**
 * Copying files into the notebook's day attachments (`attachments/YYYY/MM/DD/`).
 *
 * A capture that carries a file — a Slack upload, a document read in chat —
 * parks a copy here and records its filename in the capturing document's
 * `attachments:` frontmatter, so the reference survives whatever happens to
 * the original. Copies dedupe by content: the same file arriving twice keeps
 * one copy and one name; a different file wanting the same name gets `_2`.
 */

import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Keep untrusted attachment names within their chosen folder. */
export function safeAttachmentName(name: string): string {
  const base = name.replaceAll('\\', '/').split('/').pop()?.trim() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f:]/g, '-').replace(/^\.+/, '')
  return cleaned.length > 0 ? cleaned : 'file'
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

async function matchesFile(filePath: string, hash: string): Promise<boolean> {
  try {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      if (!(await file.stat()).isFile()) return false
      return (
        createHash('sha256')
          .update(await file.readFile())
          .digest('hex') === hash
      )
    } finally {
      await file.close()
    }
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

/**
 * Copy a file into `attachDir` under `desiredFileName`, deduplicating by SHA256.
 * - Destination exists with the same hash → no copy, the existing name is reused.
 * - Destination exists with a different hash → `_2`, `_3`, … until a free or
 *   matching name is found.
 * With `unique`, always allocate a separate copy so its owner can rename or remove it.
 * Returns the final filename (not the full path), or undefined when the source
 * does not exist.
 */
export async function copyFileDedup(
  sourcePath: string,
  attachDir: string,
  desiredFileName: string,
  options: { unique?: boolean } = {},
): Promise<string | undefined> {
  if (!existsSync(sourcePath)) return undefined

  const ext = path.extname(desiredFileName)
  const stem = desiredFileName.slice(0, -ext.length || undefined)
  const temporary = path.join(attachDir, `.attachment-${randomUUID()}.tmp`)
  try {
    await copyFile(sourcePath, temporary, constants.COPYFILE_EXCL)
    let sourceHash: string | undefined
    for (let counter = 1; ; counter++) {
      const targetName = counter === 1 ? desiredFileName : `${stem}_${counter}${ext}`
      const targetPath = path.join(attachDir, targetName)
      try {
        // Publish complete bytes atomically; concurrent captures must never overwrite a namesake.
        await link(temporary, targetPath)
        return targetName
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (options.unique) continue
        sourceHash ??= await sha256File(temporary)
        if (await matchesFile(targetPath, sourceHash)) return targetName
      }
    }
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export interface CopyToDayAttachmentsInput {
  sourcePath: string
  /** The attachments root (DIR_ATTACHMENTS); the day's directory is created beneath it */
  attachmentsRoot: string
  day: PlainDate
  /** The name the copy should carry, e.g. `2026-08-28_Chat_Atlas-MSA.pdf` */
  fileName: string
  /** A capture that will rename its images must own its copies rather than share another note's files. */
  unique?: boolean
}

/**
 * Copy one file into a day's attachments directory. A source already sitting
 * in that directory is referenced as it is, unless `unique` requests an owned copy.
 * Returns the attachment reference plus the copy's absolute path, or
 * undefined when the source does not exist.
 */
export async function copyToDayAttachments(
  input: CopyToDayAttachmentsInput,
): Promise<{ attachment: Attachment; path: string } | undefined> {
  const attachDir = path.join(input.attachmentsRoot, dayAttachmentsDir(input.day))
  const source = path.resolve(input.sourcePath)

  if (!input.unique && path.dirname(source) === path.resolve(attachDir)) {
    if (!existsSync(source)) return undefined
    return { attachment: { file: path.basename(source) }, path: source }
  }

  await mkdir(attachDir, { recursive: true })
  const file = await copyFileDedup(source, attachDir, input.fileName, { unique: input.unique })
  if (!file) return undefined
  return { attachment: { file }, path: path.join(attachDir, file) }
}
