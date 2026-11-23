/**
 * read_file's contract at both ends: what it does on disk (load, copy into
 * the day's attachments, report the copy) and what the model receives — a
 * text document inline, a PDF as a file part — validated against the AI
 * SDK's own tool-message schema, the validator production runs.
 */

import { Buffer } from 'node:buffer'
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { toolModelMessageSchema } from 'ai'
import { exists, makeTempDir, readDir, readTextFile } from '#shared/fs/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import notebookDayDir from '#shared/nbfs/dayDir.ts'
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

test('private browser file reads cannot escape through paths or symlinks', async () => {
  const { cwd, options, recorded } = await setup()
  const files = path.join(cwd, 'downloads')
  await mkdir(files)
  await writeFile(path.join(files, 'statement.txt'), 'Atlas statement')
  await writeFile(path.join(cwd, 'private.txt'), 'synthetic-private-data')
  await symlink(path.join(cwd, 'private.txt'), path.join(files, 'linked.txt'))
  const restricted = { ...options, cwd: files, allowedRoot: files }
  const denied = await Promise.all(
    ['../private.txt', path.join(cwd, 'private.txt'), 'linked.txt'].map((file) => readFile({ path: file }, restricted)),
  )
  assert({
    given: 'relative, absolute, and symlink escapes from a private task',
    should: 'reject reads before copying attachments',
    actual: [denied.every((reply) => !reply.output.success && !reply.document), recorded.length],
    expected: [true, 0],
  })
  const allowed = await readFile({ path: 'statement.txt' }, restricted)
  assert({
    given: 'a task-owned document',
    should: 'allow normal document inspection',
    actual: [allowed.output.success, allowed.document],
    expected: [true, { kind: 'text', text: 'Atlas statement' }],
  })
})

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
        source: 'attachment',
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
            `Saved copy: ${output.attachmentPath}`,
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
            `Saved copy: ${output.attachmentPath}`,
            `Attachment: 2026-01-27_Chat_atlas-msa.pdf (copied into the day's notebook attachments and recorded on this chat)`,
            'Type: PDF, 14 B — attached below',
          ].join('\n'),
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: '2026-01-27_Chat_atlas-msa.pdf',
          data: { type: 'data', data: Buffer.from(bytes).toString('base64') },
          providerOptions: { sky: { sourcePath: output.path, attachmentPath: output.attachmentPath } },
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

/** File a document under a day's attachments, the way a capture does; a note then records only its name. */
async function fileAttachment(attachmentsRoot: string, ymd: string, name: string, text: string): Promise<string> {
  const [year, month, day] = ymd.split('-')
  const dir = path.join(attachmentsRoot, year, month, day)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), text)
  return path.join(dir, name)
}

const besideNote = (cwd: string, ymd: string, name: string) =>
  path.join(cwd, 'time', notebookDayDir(new PlainDate(ymd)), 'actions', 'meetings', name)

test('readFile - a file a note lists is found in the attachments of its day', async () => {
  const { cwd, attachmentsRoot, recorded, options, dayDir } = await setup()
  const name = '2026-01-20_Zoom_Jane-Doe_Atlas-Review.txt'
  const text = 'Jane: ship Tuesday.'
  const filed = await fileAttachment(attachmentsRoot, '2026-01-20', name, text)
  const copy = attachmentFileName(DAY, name)

  const guessed = await readFile({ path: besideNote(cwd, '2026-01-20', name) }, options)
  const bare = await readFile({ path: name }, options)

  assert({
    given: 'a guessed path beside the note, for a file filed under that day',
    should: 'read the filed file, report where it really is, and copy it like any other read',
    actual: { output: guessed.output, document: guessed.document, recorded: recorded[0] },
    expected: {
      output: {
        success: true,
        source: 'attachment',
        path: filed,
        attachment: copy,
        attachmentPath: path.join(dayDir, copy),
        kind: 'text',
        bytes: text.length,
        chars: text.length,
      },
      document: { kind: 'text', text },
      recorded: { file: copy },
    },
  })
  assert({
    given: 'only the filename a note lists under attachments:',
    should: 'find it by the date the name starts with',
    actual: bare.output.success ? bare.output.path : bare.output,
    expected: filed,
  })
})

test('readFile - a file filed on another day than its name is found from the note', async () => {
  const { cwd, attachmentsRoot, options } = await setup()
  const name = '2026-01-18_Loom_Atlas-Demo.txt'
  const filed = await fileAttachment(attachmentsRoot, '2026-01-20', name, 'Atlas demo.')

  const guessed = await readFile({ path: besideNote(cwd, '2026-01-20', name) }, options)
  const bare = await readFile({ path: name }, options)

  assert({
    given: "a file dated the 18th, filed with the 20th's note, named by a path beside that note",
    should: "look in the note's day, not the date in the name",
    actual: guessed.output.success ? guessed.output.path : guessed.output,
    expected: filed,
  })
  assert({
    given: 'the same file by bare name, with nothing to say which note holds it',
    should: 'report it missing rather than search other days',
    actual: bare.output,
    expected: { success: false, error: `No such file: ${path.join(cwd, name)}` },
  })
})

test('readFile - a file at the path given wins over an attachment of the same name', async () => {
  const { cwd, attachmentsRoot, options } = await setup()
  const name = '2026-01-20_Atlas-Notes.txt'
  await fileAttachment(attachmentsRoot, '2026-01-20', name, 'The filed copy.')
  await writeFile(path.join(cwd, name), 'The local file.')

  const { output, document } = await readFile({ path: name }, options)

  assert({
    given: 'a file that exists where the path says, and a namesake in the attachments',
    should: 'read the one the path names',
    actual: { path: output.success ? output.path : output, document },
    expected: { path: path.join(cwd, name), document: { kind: 'text', text: 'The local file.' } },
  })
})

test('readFile - a name matching no attachment still fails, without recording anything', async () => {
  const { cwd, recorded, options } = await setup()
  const unfiled = '2026-01-20_Zoom_Atlas-Kickoff.txt'
  const impossible = '2026-13-45_Zoom_Atlas-Kickoff.txt'

  const [missing, invalid] = await Promise.all([unfiled, impossible].map((file) => readFile({ path: file }, options)))

  assert({
    given: 'a dated name nothing was filed under, and a name whose date cannot exist',
    should: 'fail on the path as given and record nothing',
    actual: { missing: missing.output, invalid: invalid.output, recorded },
    expected: {
      missing: { success: false, error: `No such file: ${path.join(cwd, unfiled)}` },
      invalid: { success: false, error: `No such file: ${path.join(cwd, impossible)}` },
      recorded: [],
    },
  })
})

test('private browser file reads cannot reach filed attachments', async () => {
  const { cwd, attachmentsRoot, options, recorded } = await setup()
  const files = path.join(cwd, 'downloads')
  await mkdir(files)
  const name = '2026-01-20_Zoom_Jane-Doe_Atlas-Review.txt'
  await fileAttachment(attachmentsRoot, '2026-01-20', name, 'synthetic-private-data')

  const denied = await readFile({ path: name }, { ...options, cwd: files, allowedRoot: files })

  assert({
    given: 'a private task naming a file that exists in the attachments',
    should: 'refuse it before any lookup or copy',
    actual: { output: denied.output, document: denied.document, recorded },
    expected: {
      output: { success: false, error: 'This browser task can read only its downloaded files.' },
      document: undefined,
      recorded: [],
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
        header.type === 'content' && header.value[0].type === 'text'
          ? header.value[0].text.split('\n').find((line) => line.startsWith('Type:'))
          : header,
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

test('readFile - notebook Markdown keeps its original source and records a relationship without an attachment', async () => {
  const { cwd, options, recorded, dayDir } = await setup()
  const relative = 'time/2026/W05/01-27/actions/notes/09-00_Atlas.md'
  const source = path.join(cwd, relative)
  const text = '# Atlas\n\nShip the demo on Friday.\n'
  await mkdir(path.dirname(source), { recursive: true })
  await writeFile(source, text)
  const reads: string[] = []
  const notebook = { dir: cwd, onRead: (paths: string[]) => reads.push(...paths) }
  const first = await readFile({ path: relative }, { ...options, notebook })
  await readFile({ path: source }, { ...options, notebook })
  const empty = path.join(cwd, 'Empty.md')
  await writeFile(empty, '')
  const failed = await readFile({ path: empty }, { ...options, notebook })

  assert({
    given: 'an existing notebook record read twice and an empty record that cannot be read',
    should: 'return the original text, record only successful reads, and create no attachment directory',
    actual: {
      output: first.output,
      document: first.document,
      reads,
      recorded,
      copies: await exists(dayDir),
      original: await readTextFile(source),
      failed: failed.output.success,
    },
    expected: {
      output: {
        success: true,
        source: 'notebook',
        path: await realpath(source),
        notebookPath: relative,
        kind: 'text',
        bytes: text.length,
        chars: text.length,
      },
      document: { kind: 'text', text },
      reads: [relative, relative],
      recorded: [],
      copies: false,
      original: text,
      failed: false,
    },
  })
  if (!first.output.success || !first.document) throw new Error('unreachable')
  const model = toModelContent(first.output, first.document)
  assert({
    given: 'the notebook record as the model receives it',
    should: 'identify its original source and relationship, without claiming an imported copy',
    actual: model,
    expected: {
      type: 'content',
      value: [
        {
          type: 'text',
          text: `File: ${await realpath(source)}\nNotebook record: ${relative} (recorded for this chat's rel)\nType: text, ${text.length} characters\n\n${text}`,
        },
      ],
    },
  })
  assert({
    given: 'that notebook result embedded by the SDK',
    should: 'validate as an ordinary tool result',
    actual: toolModelMessageSchema.safeParse(asToolMessage(model)).success,
    expected: true,
  })
})

test('readFile - notebook ownership follows real paths, including symlinked roots and files', async () => {
  const { cwd, options, recorded } = await setup()
  const root = path.join(cwd, 'notebook')
  const external = path.join(cwd, 'notebook-other')
  await mkdir(root)
  await mkdir(external)
  const original = path.join(root, 'Atlas.md')
  await writeFile(original, 'Notebook original.')
  await writeFile(path.join(external, 'External.md'), 'External original.')
  await symlink(root, path.join(cwd, 'notebook-link'))
  await symlink(original, path.join(external, 'Notebook-alias.md'))
  await symlink(path.join(external, 'External.md'), path.join(root, 'External-alias.md'))
  await writeFile(path.join(root, 'Contract.pdf'), '%PDF-1.4 atlas')
  const reads: string[] = []
  const scoped = {
    ...options,
    notebook: { dir: path.join(cwd, 'notebook-link'), onRead: (paths: string[]) => reads.push(...paths) },
  }
  const results: string[] = []
  for (const file of [
    path.join(external, 'Notebook-alias.md'),
    path.join(root, 'External-alias.md'),
    path.join(external, 'External.md'),
    path.join(root, 'Contract.pdf'),
  ]) {
    const result = await readFile({ path: file }, scoped)
    if (!result.output.success) throw new Error(result.output.error)
    results.push(result.output.source)
  }
  assert({
    given: 'an alias into the notebook, an alias out, a similarly named sibling, and a notebook PDF',
    should: 'link only the actual notebook Markdown record and import the external files and PDF',
    actual: { results, reads, attachments: recorded.length },
    expected: { results: ['notebook', 'attachment', 'attachment', 'attachment'], reads: ['Atlas.md'], attachments: 3 },
  })
})

test('readFile - archived Markdown and private browser downloads remain attachments', async () => {
  const { cwd, options, recorded } = await setup()
  const attachmentsRoot = path.join(cwd, 'attachments')
  const archived = await fileAttachment(attachmentsRoot, '2026-01-27', 'Imported.md', 'Imported proposal.')
  const downloads = path.join(cwd, 'downloads')
  await mkdir(downloads)
  await writeFile(path.join(downloads, 'Downloaded.md'), 'Downloaded proposal.')
  await writeFile(path.join(cwd, 'Private.md'), 'Private notebook record.')
  const reads: string[] = []
  const scoped = {
    ...options,
    attachmentsRoot,
    notebook: { dir: cwd, onRead: (paths: string[]) => reads.push(...paths) },
  }
  const retained = await readFile({ path: archived }, scoped)
  const restricted = { ...scoped, cwd: downloads, allowedRoot: downloads }
  const downloaded = await readFile({ path: 'Downloaded.md' }, restricted)
  const denied = await readFile({ path: '../Private.md' }, restricted)
  assert({
    given: 'Markdown in an attachment store inside the notebook, and a private browser with a notebook configured',
    should: 'retain attachment semantics and keep the private browser confined to its downloads',
    actual: {
      archived: retained.output.success && retained.output.source,
      downloaded: downloaded.output.success && downloaded.output.source,
      denied: denied.output.success,
      reads,
      attachments: recorded.length,
    },
    expected: { archived: 'attachment', downloaded: 'attachment', denied: false, reads: [], attachments: 2 },
  })
})

test('createFileTools - an evicted notebook result rereads its original without creating an attachment', async () => {
  const { cwd, options, recorded, dayDir } = await setup()
  await writeFile(path.join(cwd, 'Atlas.md'), 'Original notebook text.')
  const reads: string[] = []
  const tools = createFileTools({
    ...options,
    notebook: { dir: cwd, onRead: (paths) => reads.push(...paths) },
  }) as Record<
    string,
    {
      execute: (input: unknown, options: unknown) => Promise<unknown>
      toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown>
    }
  >
  const tool = tools[READ_FILE_TOOL]
  const input = { path: 'Atlas.md' }
  const first = await tool.execute(input, { toolCallId: 'notebook-original' })
  for (let i = 0; i < 9; i++) await tool.execute(input, { toolCallId: `notebook-later-${i}` })
  const result = await tool.toModelOutput({ toolCallId: 'notebook-original', input, output: first })
  assert({
    given: 'a notebook result evicted from the bounded document cache',
    should: 'reread the original as valid model content without importing or recording it again',
    actual: {
      valid: toolModelMessageSchema.safeParse(asToolMessage(result)).success,
      hasText: JSON.stringify(result).includes('Original notebook text.'),
      reads: reads.length,
      recorded,
      copies: await exists(dayDir),
    },
    expected: { valid: true, hasText: true, reads: 10, recorded: [], copies: false },
  })
})
