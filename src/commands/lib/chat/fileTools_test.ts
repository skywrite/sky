/**
 * read_file's contract at both ends: what it does on disk (load, copy into
 * the day's attachments, report the copy) and what the model receives — a
 * text document inline, a PDF as a file part — validated against the AI
 * SDK's own tool-message schema, the validator production runs.
 */

import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { toolModelMessageSchema } from 'ai'
import { makeTempDir, readDir } from '#shared/fs/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  attachmentFileName,
  createFileTools,
  type FileToolsOptions,
  MAX_TEXT_CHARS,
  READ_FILE_TOOL,
  readFile,
  resolveFilePath,
  toModelContent,
} from './fileTools.ts'

const DAY = new PlainDate('2026-01-27')

async function setup() {
  const cwd = await makeTempDir({ prefix: 'sky-read-file-src-' })
  const attachmentsRoot = await makeTempDir({ prefix: 'sky-read-file-attachments-' })
  const recorded: Attachment[] = []
  const options: FileToolsOptions = {
    today: DAY,
    attachmentsRoot,
    cwd,
    onAttachments: (files) => recorded.push(...files),
  }
  return { cwd, attachmentsRoot, recorded, options, dayDir: path.join(attachmentsRoot, '2026', '01', '27') }
}

async function names(dir: string): Promise<string[]> {
  const out: string[] = []
  for await (const entry of readDir(dir)) out.push(entry.name)
  return out.sort()
}

/** Embed a tool output exactly as the SDK embeds it before validating. */
function asToolMessage(output: unknown) {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: READ_FILE_TOOL, output }],
  }
}

test('readFile - a text file: content inline, copy in the day attachments, hook fired', async () => {
  const { cwd, recorded, options, dayDir } = await setup()
  const text = '# MSA\n\nTerm: two years.\n'
  await writeFile(path.join(cwd, 'Atlas MSA.md'), text)

  const { output, document } = await readFile({ path: 'Atlas MSA.md' }, options)

  assert({
    given: 'a markdown file named relative to the shell directory',
    should: 'resolve it, copy it as <day>_Chat_<slug>.md, record the copy, and return the text',
    actual: { output, document, recorded, files: await names(dayDir) },
    expected: {
      output: {
        success: true,
        path: path.join(cwd, 'Atlas MSA.md'),
        attachment: '2026-01-27_Chat_Atlas-MSA.md',
        attachmentPath: path.join(dayDir, '2026-01-27_Chat_Atlas-MSA.md'),
        kind: 'text',
        bytes: text.length,
        chars: text.length,
      },
      document: { kind: 'text', text },
      recorded: [{ file: '2026-01-27_Chat_Atlas-MSA.md' }],
      files: ['2026-01-27_Chat_Atlas-MSA.md'],
    },
  })

  if (!output.success || !document) throw new Error('unreachable')
  const modelOutput = toModelContent(output, document)
  assert({
    given: 'that read as the model receives it',
    should: 'lead with the file, attachment and type lines, then the text',
    actual: modelOutput,
    expected: {
      type: 'content',
      value: [
        {
          type: 'text',
          text: [
            `File: ${path.join(cwd, 'Atlas MSA.md')}`,
            `Attachment: 2026-01-27_Chat_Atlas-MSA.md (copied into the day's notebook attachments and recorded on this chat)`,
            `Type: text, ${text.length} characters`,
            '',
            text,
          ].join('\n'),
        },
      ],
    },
  })
})

test('readFile - a PDF: header text plus a base64 application/pdf file part the SDK schema accepts', async () => {
  const { cwd, options } = await setup()
  const bytes = new TextEncoder().encode('%PDF-1.4 atlas')
  const source = path.join(cwd, 'atlas-msa.pdf')
  await writeFile(source, bytes)

  const { output, document } = await readFile({ path: source }, options)
  if (!output.success || !document) throw new Error(output.success ? 'no document' : output.error)

  assert({
    given: 'a PDF',
    should: 'report kind pdf with its media type and size',
    actual: { kind: output.kind, mediaType: output.mediaType, bytes: output.bytes, attachment: output.attachment },
    expected: {
      kind: 'pdf',
      mediaType: 'application/pdf',
      bytes: bytes.length,
      attachment: '2026-01-27_Chat_atlas-msa.pdf',
    },
  })

  const modelOutput = toModelContent(output, document)
  assert({
    given: 'that read as the model receives it',
    should: 'carry a header text part and the PDF as a base64 file part',
    actual: modelOutput,
    expected: {
      type: 'content',
      value: [
        {
          type: 'text',
          text: [
            `File: ${source}`,
            `Attachment: 2026-01-27_Chat_atlas-msa.pdf (copied into the day's notebook attachments and recorded on this chat)`,
            'Type: PDF, 14 B — attached below',
          ].join('\n'),
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: '2026-01-27_Chat_atlas-msa.pdf',
          data: { type: 'data', data: Buffer.from(bytes).toString('base64') },
        },
      ],
    },
  })

  const parsed = toolModelMessageSchema.safeParse(asToolMessage(modelOutput))
  assert({
    given: 'that output embedded as the SDK embeds it',
    should: 'validate against the SDK tool-message schema',
    actual: parsed.success ? true : parsed.error.message,
    expected: true,
  })
})

test('readFile - re-reading the same file keeps one copy; a missing path and a directory fail', async () => {
  const { cwd, recorded, options, dayDir } = await setup()
  await writeFile(path.join(cwd, 'notes.txt'), 'Ship Tuesday.')
  await mkdir(path.join(cwd, 'folder'))

  await readFile({ path: 'notes.txt' }, options)
  const second = await readFile({ path: './notes.txt' }, options)
  const missing = await readFile({ path: 'missing.txt' }, options)
  const directory = await readFile({ path: 'folder' }, options)

  assert({
    given: 'the same file read twice, then a missing path, then a directory',
    should: 'dedupe the copy and fail the other two with success:false',
    actual: {
      secondAttachment: second.output.success ? second.output.attachment : second.output,
      files: await names(dayDir),
      recorded,
      missing: missing.output,
      directory: directory.output,
    },
    expected: {
      secondAttachment: '2026-01-27_Chat_notes.txt',
      files: ['2026-01-27_Chat_notes.txt'],
      recorded: [{ file: '2026-01-27_Chat_notes.txt' }, { file: '2026-01-27_Chat_notes.txt' }],
      missing: { success: false, error: `No such file: ${path.join(cwd, 'missing.txt')}` },
      directory: { success: false, error: `${path.join(cwd, 'folder')} is a directory — name a file` },
    },
  })
})

test('readFile - text past the budget is cut and the cut is reported', async () => {
  const { cwd, options } = await setup()
  const total = MAX_TEXT_CHARS + 10
  await writeFile(path.join(cwd, 'huge.log'), 'x'.repeat(total))

  const { output, document } = await readFile({ path: 'huge.log' }, options)
  if (!output.success || !document || document.kind !== 'text') throw new Error('unreachable')

  const header = toModelContent(output, document)
  assert({
    given: 'a text file ten characters over the budget',
    should: 'hand the model the first MAX_TEXT_CHARS and say what was cut',
    actual: {
      chars: output.chars,
      totalChars: output.totalChars,
      length: document.text.length,
      typeLine:
        header.type === 'content' && header.value[0].type === 'text' ? header.value[0].text.split('\n')[2] : header,
    },
    expected: {
      chars: MAX_TEXT_CHARS,
      totalChars: total,
      length: MAX_TEXT_CHARS,
      typeLine: `Type: text, cut to the first ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters of ${total.toLocaleString('en-US')}`,
    },
  })
})

test('resolveFilePath - absolute stays, relative resolves from cwd, ~ expands to home', () => {
  assert({
    given: 'the three path shapes a user types',
    should: 'resolve each to an absolute path',
    actual: [
      resolveFilePath('/tmp/x/report.pdf', '/work'),
      resolveFilePath('deals/report.pdf', '/work'),
      resolveFilePath(' ~/Desktop/report.pdf ', '/work'),
    ],
    expected: ['/tmp/x/report.pdf', '/work/deals/report.pdf', path.join(os.homedir(), 'Desktop/report.pdf')],
  })
})

test('attachmentFileName - day, Chat, slugged stem, lowercased extension', () => {
  assert({
    given: 'a source path with spaces, punctuation and an uppercase extension',
    should: 'name the copy <day>_Chat_<slug><ext>',
    actual: [attachmentFileName(DAY, '/x/Atlas MSA (final).PDF'), attachmentFileName(DAY, '/x/—.pdf')],
    expected: ['2026-01-27_Chat_Atlas-MSA-final.pdf', '2026-01-27_Chat_file.pdf'],
  })
})

test('createFileTools - execute then toModelOutput, the way the SDK drives a tool', async () => {
  const { cwd, options } = await setup()
  await writeFile(path.join(cwd, 'notes.txt'), 'Ship Tuesday.')
  const tools = createFileTools(options) as Record<
    string,
    {
      execute: (input: unknown, opts: unknown) => Promise<unknown>
      toModelOutput: (opts: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown>
    }
  >
  const tool = tools[READ_FILE_TOOL]

  const output = await tool.execute({ path: 'notes.txt' }, { toolCallId: 'tc1', messages: [] })
  const modelOutput = (await tool.toModelOutput({ toolCallId: 'tc1', input: { path: 'notes.txt' }, output })) as {
    type: string
    value: Array<{ type: string; text: string }>
  }
  assert({
    given: 'a successful execute followed by toModelOutput for the same call id',
    should: 'hand the model the document text without re-reading it',
    actual: { type: modelOutput.type, tail: modelOutput.value[0].text.endsWith('\n\nShip Tuesday.') },
    expected: { type: 'content', tail: true },
  })

  const failed = await tool.execute({ path: 'missing.txt' }, { toolCallId: 'tc2', messages: [] })
  assert({
    given: 'a failed execute',
    should: 'pass the failure through as plain json',
    actual: await tool.toModelOutput({ toolCallId: 'tc2', input: { path: 'missing.txt' }, output: failed }),
    expected: { type: 'json', value: { success: false, error: `No such file: ${path.join(cwd, 'missing.txt')}` } },
  })
})
