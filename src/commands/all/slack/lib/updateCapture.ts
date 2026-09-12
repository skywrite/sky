import * as path from 'node:path'
import { DIR_ATTACHMENTS } from '#config'
import slugify from '#lib/string/slugify.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { relocateSlackFileLinks } from '#shared/models/Message/slack/files.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { voiceTranscriptIds } from '#shared/models/Message/slack/transcripts.ts'
import {
  isSlackSavedFile,
  markdownLabel,
  matchSlackMessages,
  pendingSlackAttachment,
  slackAttachmentFile,
  updateSlackConversation,
  type SlackSavedAttachment,
  type SlackSavedFile,
  type SlackWriteMessage,
} from '#shared/models/Message/slack/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { writeMessage, type SlackCaptureMessage } from './captureMessages.ts'
import { legacySlackFile, relocateSlackFiles, storeSlackFiles, type SlackFileRef } from './copyToAttachments.ts'
import { transcribeSlackVoiceMemo, type VoiceTranscriptionOptions } from './transcribeVoiceMemo.ts'

/** Prepare the complete document before the caller replaces a saved file or advances a follow. */
export async function updateSlackCapture(input: {
  doc: MessageDocument
  messages: readonly SlackCaptureMessage[]
  day: PlainDate
  output: { log: (message: string) => void }
  /** Older internal callers can preserve files, but cannot recover message ownership. */
  files?: SlackFileRef[]
  attachmentsRoot?: string
  /** Captures without a follow use their own document slug. */
  captureSlug?: string
  signal?: AbortSignal
  transcriptRuns?: Set<string>
  transcribe?: typeof transcribeSlackVoiceMemo
  transcriptionOptions?: VoiceTranscriptionOptions
}): Promise<MessageDocument> {
  const { doc, day, output } = input
  const parsed = parseSlackConversation(doc.markdown)
  const originalFiles = parsed.attachments.flatMap((attachment): SlackSavedFile[] => {
    const file = slackAttachmentFile(attachment)
    return file && attachment.id ? [{ id: attachment.id, name: attachment.name, file }] : []
  })
  const folder =
    typeof doc.yaml['follow'] === 'string' && doc.yaml['follow']
      ? doc.yaml['follow']
      : (input.captureSlug ??
        doc.attachments.find((a) => a.file.includes('/'))?.file.split('/')[0] ??
        `${day}_slack_${slugify(doc.summary || 'Conversation', { preserveCase: true })}`)
  const storage = {
    folder,
    attachmentsRoot: input.attachmentsRoot,
    pendingIds: new Set(parsed.attachments.filter((a) => a.id && pendingSlackAttachment(a)).map((a) => a.id!)),
  }
  const renamed = await relocateSlackFiles([...doc.attachments, ...originalFiles], day, storage)
  const relocated = <T extends Attachment>(file: T): T => ({ ...file, file: renamed.get(file.file) ?? file.file })
  const prior = doc.attachments.map(relocated)
  const known = originalFiles.map(relocated)
  const savedFiles: SlackSavedAttachment[] = []
  const messages: SlackWriteMessage[] = []
  const matched = matchSlackMessages(parsed.messages, input.messages.map(writeMessage))
  for (const message of input.messages) {
    const files = await storeSlackFiles(message.files ?? [], day, output, {
      ...storage,
      sourceId: writeMessage(message).id,
      prior: [...prior, ...savedFiles.filter(isSlackSavedFile)],
      known: [...known, ...savedFiles.filter(isSlackSavedFile)],
    })
    savedFiles.push(...files)
    const written = { ...writeMessage(message), attachments: files }
    const voiceFiles = (message.files ?? []).flatMap((file, index) =>
      file.voiceMemo ? [{ source: file, saved: files[index] }] : [],
    )
    const present = voiceTranscriptIds(
      matched.get(written.id),
      voiceFiles.map((file) => file.saved.id),
    )
    const transcripts: NonNullable<SlackWriteMessage['transcripts']> = []
    for (const file of voiceFiles) {
      if (present.has(file.saved.id) || file.source.voiceTranscript === null) continue
      if (!isSlackSavedFile(file.saved) && !file.source.voiceTranscript) continue
      try {
        const text =
          file.source.voiceTranscript ??
          (await (input.transcribe ?? transcribeSlackVoiceMemo)(
            file.source,
            path.join(input.attachmentsRoot ?? DIR_ATTACHMENTS, dayAttachmentsDir(day), file.saved.file!),
            { ...input.transcriptionOptions, signal: input.signal, runs: input.transcriptRuns },
          ))
        transcripts.push({ attachmentId: file.saved.id, text })
        present.add(file.saved.id)
      } catch (error) {
        input.signal?.throwIfAborted()
        output.log(
          `  Voice memo transcript pending: ${file.saved.name} (${error instanceof Error ? error.message : String(error)})`,
        )
      }
    }
    messages.push({ ...written, transcripts, voiceAttachmentIds: voiceFiles.map((file) => file.saved.id) })
  }
  savedFiles.push(
    ...(await storeSlackFiles(input.files ?? [], day, output, {
      ...storage,
      prior: [...prior, ...savedFiles.filter(isSlackSavedFile)],
      known: [...known, ...savedFiles.filter(isSlackSavedFile)],
    })),
  )
  const originals = savedFiles.filter(isSlackSavedFile)
  for (const file of originals) {
    const original = originalFiles.find((known) => known.id === file.id)
    if (original && original.file !== file.file) renamed.set(original.file, file.file)
  }
  const represented = new Set([...known, ...originals].map((file) => file.file))
  const inventory = [
    ...savedFiles,
    ...doc.attachments
      .filter((file) => !represented.has(relocated(file).file))
      .map((file) => relocated(legacySlackFile(file))),
  ]
  const markdown = updateSlackConversation(
    relocateSlackFileLinks(doc.markdown, renamed) || `# ${markdownLabel(doc.summary || 'Slack conversation')}\n\n`,
    messages,
    inventory,
  )
  const updatedFiles = parseSlackConversation(markdown).attachments
  for (const original of originalFiles) {
    if (
      renamed.has(original.file) &&
      slackAttachmentFile(updatedFiles.find((a) => a.id === original.id)!) !== renamed.get(original.file)
    )
      throw new Error('Cannot safely update a relocated Slack attachment link.')
  }
  // Preserve the raw metadata of existing entries, including fields the generic
  // Attachment model doesn't know. New entries use the normal { file } schema.
  const attachments = (Array.isArray(doc.yaml['attachments']) ? doc.yaml['attachments'] : []).map((entry: unknown) =>
    entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string'
      ? relocated(entry as Attachment)
      : entry,
  )
  const names = new Set(doc.attachments.map((attachment) => relocated(attachment).file))
  for (const file of originals) {
    if (names.has(file.file)) continue
    names.add(file.file)
    attachments.push({ file: file.file } satisfies Attachment)
  }
  return new MessageDocument({ ...doc.yaml, ...(attachments.length ? { attachments } : {}) }, markdown)
}
