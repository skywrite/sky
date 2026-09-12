import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentSlackFile } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { DIR_ATTACHMENTS } from '#config'
import { copyFileDedup, sha256File } from '#lib/notebook/attachments.ts'
import { exists } from '#shared/fs/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { isSlackAttachmentPath } from '#shared/models/Message/slack/files.ts'
import type { SlackSavedFile } from '#shared/models/Message/slack/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export type SlackFileRef = AgentSlackFile

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

/** Originals only: no image inspection or filename generation. Returns one record per input file. */
export async function storeSlackFiles(
  files: readonly SlackFileRef[],
  whenDate: PlainDate,
  output: { log: (msg: string) => void },
  options: SlackStorage,
): Promise<SlackSavedFile[]> {
  if (files.length === 0) return []
  const { dayDir, folderDir } = storageDirs(whenDate, options)
  const { prior = [], known = [] } = options
  const stored: SlackSavedFile[] = []
  const hashes = new Map<string, string>()
  const fileHash = async (file: string) => {
    if (!isSlackAttachmentPath(file)) throw new Error('Invalid saved Slack attachment path.')
    if (!hashes.has(file)) hashes.set(file, await sha256File(path.join(dayDir, file)))
    return hashes.get(file)!
  }
  for (const file of files) {
    if (file.id && !/^[A-Z0-9]+$/.test(file.id)) throw new Error('Invalid Slack file ID.')
    const providerId = file.id ? `attachment-slack-${file.id}` : undefined
    const existing = [...known, ...stored].find((saved) => saved.id === providerId)
    if (
      existing &&
      path.posix.dirname(existing.file) === options.folder &&
      (await exists(path.join(dayDir, existing.file)))
    ) {
      stored.push({ ...existing, name: file.name || existing.name })
      continue
    }
    // agent-slack may return an error receipt at path. Never archive it as the original.
    if (file.error || !file.path)
      throw new Error(
        `Slack attachment unavailable: ${file.name ?? file.id ?? 'file'}${file.error ? ` (${file.error})` : ''}`,
      )
    const hash = await sha256File(file.path)
    const id = providerId ?? `attachment-local-${hash}`
    const name = file.name || path.basename(file.path)
    let finalName: string | undefined
    // A legacy image may have an AI-generated storage name. Reuse it only
    // when its bytes match, never by guessing from filename or file order.
    for (const candidate of [...prior, ...stored]) {
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
      await mkdir(folderDir, { recursive: true })
      const copied = await copyFileDedup(
        file.path,
        folderDir,
        existing ? path.basename(existing.file) : `${whenDate}_Slack_${safeName}`,
      )
      if (copied) finalName = `${options.folder}/${copied}`
    }
    if (!finalName) throw new Error(`Slack attachment could not be copied: ${name}`)
    stored.push({ id, name, file: finalName })
    output.log(`  Attachment: ${finalName}`)
  }
  return stored
}
