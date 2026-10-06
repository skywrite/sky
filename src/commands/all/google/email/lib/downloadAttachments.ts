import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { GoogleClient } from '#lib/google/client.ts'
import { getMessageAttachment, type GmailMessage } from '#lib/google/gmail.ts'
import { copyFileDedup, safeAttachmentName } from '#lib/notebook/attachments.ts'
import { attachmentInventory, type ReadAttachment } from './readThreadContent.ts'

export interface AttachmentDownloadResult {
  directory: string
  complete: boolean
  cancelled: boolean
  totalAttachments: number
  files: Array<ReadAttachment & { path: string; bytes: number; sha256: string }>
  errors: Array<ReadAttachment & { error: string }>
}

/** A selected part always belongs to the fetched thread and its resolved mailbox. */
export async function downloadAttachments(
  client: GoogleClient,
  messages: GmailMessage[],
  options: { directory: string; message?: string; part?: string; signal?: AbortSignal },
): Promise<AttachmentDownloadResult> {
  if (options.part && !options.message) throw new Error('Select message as well as part, using the email read result.')
  if (options.message && !messages.some((message) => message.id === options.message))
    throw new Error('That message is not in this Gmail thread. Use a messageId from its attachment list.')
  const selected = attachmentInventory(messages).filter(
    (attachment) =>
      (!options.message || attachment.messageId === options.message) &&
      (!options.part || attachment.partId === options.part),
  )
  if (options.part && !selected.length)
    throw new Error('That attachment part is not in the selected message. Read the email’s attachment list again.')
  const result: AttachmentDownloadResult = {
    directory: options.directory,
    complete: true,
    cancelled: false,
    totalAttachments: selected.length,
    files: [],
    errors: [],
  }
  for (const entry of selected) {
    try {
      options.signal?.throwIfAborted()
      const message = messages.find((message) => message.id === entry.messageId)!
      const attachment = message.attachments.find((item) => (item.partId ?? item.attachmentId ?? '') === entry.partId)!
      const bytes = await getMessageAttachment(client, message.id, attachment)
      options.signal?.throwIfAborted()
      const saved = await saveBytes(bytes, options.directory, entry.filename)
      result.files.push({ ...entry, ...saved })
    } catch (error) {
      result.errors.push({
        ...entry,
        error: options.signal?.aborted
          ? 'Stopped before this attachment was saved. Retry this message and part to continue.'
          : error instanceof Error
            ? error.message
            : String(error),
      })
    }
  }
  result.cancelled = options.signal?.aborted ?? false
  result.complete = result.errors.length === 0 && !result.cancelled
  return result
}

async function saveBytes(bytes: Uint8Array, directory: string, filename: string) {
  await mkdir(directory, { recursive: true })
  // Private temporary bytes are never exposed as a completed download.
  const staging = await mkdtemp(path.join(tmpdir(), 'sky-email-attachment-'))
  try {
    const source = path.join(staging, 'content')
    await writeFile(source, bytes, { flag: 'wx', mode: 0o600 })
    const name = await copyFileDedup(source, directory, safeAttachmentName(filename))
    if (!name) throw new Error('The attachment could not be saved. Retry the download.')
    const savedPath = path.join(directory, name)
    const saved = await readFile(savedPath)
    if (!saved.equals(bytes))
      throw new Error(`The saved bytes at ${savedPath} could not be verified. Retry the download.`)
    return { path: savedPath, bytes: saved.length, sha256: createHash('sha256').update(saved).digest('hex') }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
