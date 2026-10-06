import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { LanguageModelV4FilePart, LanguageModelV4Prompt } from '@ai-sdk/provider'

interface Attachment {
  key: string
  file: LanguageModelV4FilePart
  source: string
  earlier: boolean
  bytes: number
}

/** Visit only input files; generated files, reasoning and tool receipts stay intact. */
function mapFiles(
  prompt: LanguageModelV4Prompt,
  visit: (
    file: LanguageModelV4FilePart,
    key: string,
    header: string,
    earlier: boolean,
  ) => LanguageModelV4FilePart | { type: 'text'; text: string },
): LanguageModelV4Prompt {
  let user = -1
  const lastAssistant = prompt.findLastIndex((message) => {
    if (message.role !== 'assistant' || message.providerOptions?.sky?.hostNotice === true) return false
    // Legacy recovery snapshots stored the host's failure notice as assistant
    // prose. That notice is not a model step that could have read a new file.
    if (
      message.content.some(
        (part) =>
          part.type === 'text' &&
          /\[The response failed:[\s\S]*Completed tool results above remain valid; check them before retrying any action\.\]$/.test(
            part.text,
          ),
      )
    )
      return false
    return message.content.some((part) =>
      part.type === 'text' || part.type === 'reasoning' ? part.text.trim().length > 0 : true,
    )
  })
  return prompt.map((message, index) => {
    const earlier = index < lastAssistant
    if (message.role === 'user') {
      user++
      let header = ''
      return {
        ...message,
        content: message.content.map((part, partIndex) => {
          if (part.type === 'text') header = part.text
          return part.type === 'file' ? visit(part, `user:${user}:${partIndex}`, header, earlier) : part
        }),
      }
    }
    if (message.role !== 'tool') return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result' || part.output.type !== 'content') return part
        let header = ''
        return {
          ...part,
          output: {
            ...part.output,
            value: part.output.value.map((content, contentIndex) => {
              if (content.type === 'text') header = content.text
              return content.type === 'file'
                ? visit(content, `tool:${part.toolCallId}:${contentIndex}`, header, earlier)
                : content
            }),
          },
        }
      }),
    }
  })
}

function sourcePath(file: LanguageModelV4FilePart, header: string): string | undefined {
  const meta = file.providerOptions?.sky
  for (const value of [meta?.attachmentPath, meta?.sourcePath]) if (typeof value === 'string' && value) return value
  // Older saved chats predate source metadata. Their read_file/upload header
  // still identifies a local source. A bare filename is not a reopenable path.
  return /^Saved copy: (.+)$/m.exec(header)?.[1] ?? /^File: (.+)$/m.exec(header)?.[1]
}

function inlineBytes(file: LanguageModelV4FilePart): number {
  if (file.data.type !== 'data') return 0
  return typeof file.data.data === 'string' ? file.data.data.length : Math.ceil(file.data.data.byteLength / 3) * 4
}

function attachments(prompt: LanguageModelV4Prompt): Attachment[] {
  const found: Attachment[] = []
  mapFiles(prompt, (file, key, header, earlier) => {
    const bytes = inlineBytes(file)
    const source = sourcePath(file, header)
    if (bytes && source) found.push({ key, file, source, earlier, bytes })
    return file
  })
  return found
}

function identity({ file, source }: Attachment): string {
  if (file.data.type !== 'data') return source
  const bytes = typeof file.data.data === 'string' ? Buffer.from(file.data.data, 'base64') : file.data.data
  return `${source}:${file.mediaType}:${createHash('sha256').update(bytes).digest('hex')}`
}

/**
 * Binary files are working input, not permanent prompt text. Keep the original
 * history for recovery; send references once a later model step exists. This
 * does not assert inspection: a step may have failed or deferred a batch member.
 */
export class AttachmentContext {
  private readonly state: { deferredAttachments?: string[] }

  constructor(state: { deferredAttachments?: string[] } = {}) {
    this.state = state
  }

  prepare(prompt: LanguageModelV4Prompt): { prompt: LanguageModelV4Prompt; referenced: number; deferred: number } {
    const pending = new Set(this.state.deferredAttachments)
    // A deferred batch member stays explicitly pending across turns/restarts.
    // A later individual read can satisfy it without retaining duplicate bytes.
    if (pending.size) {
      const files = attachments(prompt)
      const inspected = new Set(files.filter((file) => file.earlier && !pending.has(file.key)).map(identity))
      for (const file of files) if (pending.has(file.key) && inspected.has(identity(file))) pending.delete(file.key)
    }
    if (this.state.deferredAttachments) this.state.deferredAttachments = [...pending]
    let referenced = 0
    let deferred = 0
    const prepared = mapFiles(prompt, (file, key, header, earlier) => {
      const source = sourcePath(file, header)
      if (!source || !inlineBytes(file) || (!earlier && !pending.has(key))) return file
      const postponed = pending.has(key)
      if (postponed) deferred++
      else referenced++
      return {
        type: 'text',
        text: `[Attachment ${JSON.stringify(file.filename ?? source)} (${file.mediaType}): ${
          postponed
            ? 'contents deferred because this batch exceeds the request size limit. This file still needs inspection'
            : 'earlier binary contents are not repeated in this request. Keep using recorded findings; this reference alone is not evidence of inspection'
        }. The original file and full history are preserved. Use read_file with path ${JSON.stringify(source)} to inspect details not already recorded. Inspect large files one at a time and record the relevant facts before reading the next file.]`,
      }
    })
    return { prompt: prepared, referenced, deferred }
  }

  /** Defer oldest batch members first, always retaining the newest file for inspection. */
  reduce(prompt: LanguageModelV4Prompt, bytesToRemove: number): boolean {
    const files = attachments(prompt)
    const pending = new Set(this.state.deferredAttachments)
    let removed = 0
    for (const file of files.slice(0, -1)) {
      pending.add(file.key)
      removed += file.bytes
      if (removed >= bytesToRemove) break
    }
    if (removed) this.state.deferredAttachments = [...pending]
    return removed > 0
  }

  remaining(prompt: LanguageModelV4Prompt): string[] {
    return attachments(prompt).map(({ file, source }) => file.filename ?? source)
  }
}
