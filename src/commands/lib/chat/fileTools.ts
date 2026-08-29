/**
 * read_file — the chat tool that brings a local document into the conversation.
 *
 * The model names a path; the tool loads it (PDFs and images as bytes, Office,
 * Apple, spreadsheet and text formats as text — see lib/documents), copies it
 * into the day's notebook attachments, reports the copy to the host so the
 * transcript's `attachments:` records it, and hands the content to the model
 * as the tool result: PDFs and images as native file parts, text inline. From
 * then on the document is simply in context — summarize, quote, compare.
 *
 * Built in like the web tools rather than a @AIChatTool command: its output
 * is the document itself, which has no meaning outside a model turn.
 */

import { Buffer } from 'node:buffer'
import { stat } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { jsonSchema, type Tool, tool } from 'ai'
import { IMAGE_EXTENSIONS, loadDocument, type LoadedDocument, PDF_EXTENSIONS } from '#lib/documents/loadDocument.ts'
import { copyToDayAttachments } from '#lib/notebook/attachments.ts'
import { slugify } from '#lib/string/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** What toModelOutput returns — the SDK exports the hook's type but not its result's. */
type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>

export const READ_FILE_TOOL = 'read_file'

/**
 * PDFs and images travel base64-encoded inside the request, which also
 * carries the whole conversation and context — Anthropic caps a request at
 * 32 MB, and a PDF further at 100 pages.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Text past this is cut: a document is read into context, not instead of it. */
export const MAX_TEXT_CHARS = 200_000

export interface FileToolsOptions {
  /** The chat's notebook day — the copy lands in this day's attachments */
  today: PlainDate
  /** The attachments root (DIR_ATTACHMENTS) */
  attachmentsRoot: string
  /** Where a relative path resolves from — the user's shell directory */
  cwd: string
  /** Fires once per read with the copy's attachment ref — the host carries it into the transcript */
  onAttachments: (files: Attachment[]) => void
}

export interface ReadFileInput {
  path: string
}

export type ReadFileOutput =
  | {
      success: true
      /** The source, resolved */
      path: string
      /** Filename of the copy in the day's attachments */
      attachment: string
      attachmentPath: string
      kind: LoadedDocument['kind']
      mediaType?: string
      bytes: number
      /** Text documents: characters handed to the model, after any cut */
      chars?: number
      /** Text documents: characters in the whole document, when it was cut */
      totalChars?: number
    }
  | { success: false; error: string }

export type ReadFileSuccess = Extract<ReadFileOutput, { success: true }>

/**
 * What execute loaded, kept for toModelOutput by tool call id — the raw
 * output stays small JSON (it is logged and token-estimated as such) while
 * the document itself is built into the model-facing result. Bounded: a
 * session reads a handful of files, and a miss re-reads the copy.
 */
const loaded = new Map<string, LoadedDocument>()
const MAX_REMEMBERED = 8

function remember(toolCallId: string, document: LoadedDocument): void {
  loaded.set(toolCallId, document)
  while (loaded.size > MAX_REMEMBERED) {
    const oldest = loaded.keys().next().value
    if (oldest === undefined) break
    loaded.delete(oldest)
  }
}

export function resolveFilePath(given: string, cwd: string): string {
  const trimmed = given.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd, trimmed)
}

/** `<day>_Chat_<slugged stem><ext>` — the same shape Slack and email captures use. */
export function attachmentFileName(day: PlainDate, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const stem = path.basename(filePath, path.extname(filePath))
  const slug = slugify(stem, { preserveCase: true, suggestedLength: 60 }) || 'file'
  return `${day.ymd}_Chat_${slug}${ext}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Cut text documents to the budget, reporting the whole length. */
function fitText(document: LoadedDocument): { document: LoadedDocument; totalChars?: number } {
  if (document.kind !== 'text' || document.text.length <= MAX_TEXT_CHARS) return { document }
  return { document: { kind: 'text', text: document.text.slice(0, MAX_TEXT_CHARS) }, totalChars: document.text.length }
}

/** The lines above the content: where it came from, where the copy lives, what it is. */
function describe(output: ReadFileSuccess): string {
  const lines = [
    `File: ${output.path}`,
    `Attachment: ${output.attachment} (copied into the day's notebook attachments and recorded on this chat)`,
  ]
  if (output.kind === 'text') {
    const size = `${(output.chars ?? 0).toLocaleString('en-US')} characters`
    lines.push(
      output.totalChars !== undefined
        ? `Type: text, cut to the first ${size} of ${output.totalChars.toLocaleString('en-US')}`
        : `Type: text, ${size}`,
    )
  } else {
    lines.push(`Type: ${output.kind === 'pdf' ? 'PDF' : 'image'}, ${formatBytes(output.bytes)} — attached below`)
  }
  return lines.join('\n')
}

/** The document as the model receives it: text inline, PDFs and images as file parts. */
export function toModelContent(output: ReadFileSuccess, document: LoadedDocument): ToolResultOutput {
  const header = describe(output)
  if (document.kind === 'text') {
    return { type: 'content', value: [{ type: 'text', text: `${header}\n\n${document.text}` }] }
  }
  return {
    type: 'content',
    value: [
      { type: 'text', text: header },
      {
        type: 'file',
        mediaType: document.mediaType,
        filename: output.attachment,
        data: { type: 'data', data: Buffer.from(document.data).toString('base64') },
      },
    ],
  }
}

/** Load, copy, record. The document rides back beside the output so execute can keep it for toModelOutput. */
export async function readFile(
  input: ReadFileInput,
  options: FileToolsOptions,
): Promise<{ output: ReadFileOutput; document?: LoadedDocument }> {
  const resolved = resolveFilePath(input.path, options.cwd)
  const fail = (error: string) => ({ output: { success: false, error } as ReadFileOutput })

  let info
  try {
    info = await stat(resolved)
  } catch {
    return fail(`No such file: ${resolved}`)
  }
  if (info.isDirectory()) return fail(`${resolved} is a directory — name a file`)

  const ext = path.extname(resolved).toLowerCase()
  if ((PDF_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) && info.size > MAX_FILE_BYTES) {
    return fail(
      `${path.basename(resolved)} is ${formatBytes(info.size)}; the largest PDF or image read_file can pass to the model is ${formatBytes(MAX_FILE_BYTES)}`,
    )
  }

  const result = await loadDocument(resolved)
  if (!result.success) return fail(result.error)
  const { document, totalChars } = fitText(result.document)

  const copied = await copyToDayAttachments({
    sourcePath: resolved,
    attachmentsRoot: options.attachmentsRoot,
    day: options.today,
    fileName: attachmentFileName(options.today, resolved),
  })
  if (!copied) return fail(`No such file: ${resolved}`)
  options.onAttachments([copied.attachment])

  const output: ReadFileSuccess = {
    success: true,
    path: resolved,
    attachment: copied.attachment.file,
    attachmentPath: copied.path,
    kind: document.kind,
    bytes: info.size,
  }
  if (document.kind === 'text') {
    output.chars = document.text.length
    if (totalChars !== undefined) output.totalChars = totalChars
  } else {
    output.mediaType = document.mediaType
  }
  return { output, document }
}

/** The document behind a successful read: what execute loaded, else the copy re-read. */
async function documentFor(toolCallId: string, output: ReadFileSuccess): Promise<LoadedDocument | undefined> {
  const kept = loaded.get(toolCallId)
  if (kept) return kept
  const reread = await loadDocument(output.attachmentPath)
  return reread.success ? fitText(reread.document).document : undefined
}

export function createFileTools(options: FileToolsOptions): Record<string, unknown> {
  return {
    [READ_FILE_TOOL]: tool({
      description:
        "Read a local file into this conversation by path: PDF, image (png, jpg, gif, webp), Word/Pages, PowerPoint/Keynote, Excel/Numbers, CSV, markdown, or plain text. Returns the document itself (PDFs and images attached, the rest as text), copies it into today's notebook attachments, and records it on this chat. Call it whenever the user points at a file on disk to read, summarize, review, or discuss.",
      inputSchema: jsonSchema<ReadFileInput>({
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: "Absolute path, ~/path, or a path relative to the user's shell directory",
          },
        },
        required: ['path'],
      }),
      execute: async (input: ReadFileInput, { toolCallId }): Promise<ReadFileOutput> => {
        const { output, document } = await readFile(input, options)
        if (document) remember(toolCallId, document)
        return output
      },
      toModelOutput: async ({ toolCallId, output }) => {
        if (!output.success) return { type: 'json', value: output }
        const document = await documentFor(toolCallId, output)
        if (!document) {
          return {
            type: 'json',
            value: { ...output, error: `The copy at ${output.attachmentPath} could not be read back` },
          }
        }
        return toModelContent(output, document)
      },
    }),
  }
}
