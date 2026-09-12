import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_ATTACHMENTS } from '#config'
import { copyFileDedup, sha256File } from '#lib/notebook/attachments.ts'
import { exists } from '#shared/fs/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { isSlackAttachmentPath, slackSourceUrl } from '#shared/models/Message/slack/files.ts'
import { isSlackSavedFile, type SlackSavedAttachment, type SlackSavedFile } from '#shared/models/Message/slack/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { SlackCaptureFile } from './voiceFiles.ts'

export type SlackFileRef = SlackCaptureFile

export function legacySlackFile(attachment: Attachment): SlackSavedFile {
  return {
    id: `attachment-local-${createHash('sha256').update(attachment.file).digest('hex')}`,
    name: path.basename(attachment.file),
    file: attachment.file,
  }
}

interface SlackStorage {
  folder: string
  attachmentsRoot?: string
  prior?: readonly Attachment[]
  known?: readonly SlackSavedFile[]
  sourceId?: string
  pendingIds?: ReadonlySet<string>
}

function storageDirs(day: PlainDate, options: SlackStorage) {
  if (!isSlackAttachmentPath(options.folder) || options.folder.includes('/'))
    throw new Error('Invalid Slack follow folder.')
  const dayDir = path.join(options.attachmentsRoot ?? DIR_ATTACHMENTS, dayAttachmentsDir(day))
  return { dayDir, folderDir: path.join(dayDir, options.folder) }
}

/** Copy before the document is saved; old paths may still be referenced by other captures. */
export async function relocateSlackFiles(
  files: readonly Attachment[],
  day: PlainDate,
  options: SlackStorage,
): Promise<Map<string, string>> {
  const { dayDir, folderDir } = storageDirs(day, options)
  const renamed = new Map<string, string>()
  for (const { file } of files) {
    if (!isSlackAttachmentPath(file)) throw new Error('Invalid saved Slack attachment path.')
    if (path.posix.dirname(file) === options.folder || renamed.has(file)) continue
    const source = path.join(dayDir, file)
    if (!(await exists(source))) continue
    await mkdir(folderDir, { recursive: true })
    const stored = await copyFileDedup(source, folderDir, path.basename(file))
    if (!stored) throw new Error('Slack attachment could not be relocated.')
    renamed.set(file, `${options.folder}/${stored}`)
  }
  return renamed
}

/** Preserve originals or source links, with a retryable reference for unavailable downloads. */
export async function storeSlackFiles(
  files: readonly SlackFileRef[],
  whenDate: PlainDate,
  output: { log: (msg: string) => void },
  options: SlackStorage,
): Promise<SlackSavedAttachment[]> {
  if (files.length === 0) return []
  const { dayDir, folderDir } = storageDirs(whenDate, options)
  const { prior = [], known = [] } = options
  const stored: SlackSavedAttachment[] = []
  const hashes = new Map<string, string>()
  const fileHash = async (file: string) => {
    if (!isSlackAttachmentPath(file)) throw new Error('Invalid saved Slack attachment path.')
    if (!hashes.has(file)) hashes.set(file, await sha256File(path.join(dayDir, file)))
    return hashes.get(file)!
  }
  for (const [index, file] of files.entries()) {
    if (file.id && !/^[A-Z0-9]+$/.test(file.id)) throw new Error('Invalid Slack file ID.')
    const providerId = file.id ? `attachment-slack-${file.id}` : undefined
    // Failed downloads have no original bytes to hash. Message identity and file
    // position keep their fallback anchor stable when a later fetch succeeds.
    const fallbackId = `attachment-pending-${createHash('sha256')
      .update(`${options.sourceId ?? options.folder}\n${index}\n${file.name ?? ''}`)
      .digest('hex')}`
    const existing = [...known, ...stored.filter(isSlackSavedFile)].find(
      (saved) => saved.id === (providerId ?? fallbackId),
    )
    if (
      existing &&
      path.posix.dirname(existing.file) === options.folder &&
      (await exists(path.join(dayDir, existing.file)))
    ) {
      stored.push({ ...existing, name: file.name || existing.name })
      continue
    }
    const name = file.name || file.id || (file.path ? path.basename(file.path) : 'Attachment')
    const referenceId = providerId ?? fallbackId
    const pending = () => {
      stored.push({ id: referenceId, name, pending: true, url: slackSourceUrl(file.sourceUrl) })
      output.log(`  Attachment pending: ${name} (original unavailable; will retry)`)
    }
    const externalUrl = slackSourceUrl(file.externalUrl)
    if (externalUrl) {
      stored.push({ id: referenceId, name, url: externalUrl })
      continue
    }
    // agent-slack may return an error receipt at path. Never archive it as the original.
    if (file.mode === 'external' || file.error || !file.path || file.path.endsWith('.download-error.txt')) {
      pending()
      continue
    }
    let hash: string
    try {
      hash = await sha256File(file.path)
    } catch {
      pending()
      continue
    }
    const id = providerId ?? (options.pendingIds?.has(fallbackId) ? fallbackId : `attachment-local-${hash}`)
    let finalName: string | undefined
    // A legacy image may have an AI-generated storage name. Reuse it only
    // when its bytes match, never by guessing from filename or file order.
    for (const candidate of [...prior, ...stored.filter(isSlackSavedFile)]) {
      if (
        path.posix.dirname(candidate.file) === options.folder &&
        (await exists(path.join(dayDir, candidate.file))) &&
        (await fileHash(candidate.file)) === hash
      ) {
        finalName = candidate.file
        break
      }
    }
    if (!finalName) {
      const safeName =
        name
          .replaceAll('\\', '/')
          .split('/')
          .pop()!
          .replace(/[\u0000-\u001f:]/g, '-')
          .replace(/^\.+/, '') || 'file'
      try {
        await mkdir(folderDir, { recursive: true })
        const copied = await copyFileDedup(
          file.path,
          folderDir,
          existing ? path.basename(existing.file) : `${whenDate}_Slack_${safeName}`,
        )
        if (copied) finalName = `${options.folder}/${copied}`
      } catch {
        pending()
        continue
      }
    }
    if (!finalName) {
      pending()
      continue
    }
    stored.push({ id, name, file: finalName })
    output.log(`  Attachment: ${finalName}`)
  }
  return stored
}
