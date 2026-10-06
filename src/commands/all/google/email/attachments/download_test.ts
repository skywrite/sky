import { mkdtemp, readFile as readBytes, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import { readFile, toModelContent } from '#commands/lib/chat/fileTools.ts'
import { commandDescriptionToSchema } from '#commands/lib/jsonSchema.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { addGmailAccount, commandArgs, mailboxOf, withGmail } from '../lib/testGmail.ts'
import Read from '../read.ts'
import Download from './download.ts'

const pdf = Buffer.from('%PDF-1.4\nSynthetic Atlas document\n%%EOF')
const args = (directory: string) => ({
  thread: 'ff',
  directory,
  message: undefined as string | undefined,
  part: undefined as string | undefined,
  account: undefined as string | undefined,
})
const message = (parts: unknown[]) => ({ id: 'm1', threadId: 'ff', payload: { mimeType: 'multipart/mixed', parts } })
const part = (partId: string, filename: string, contentType: string, bytes: Uint8Array, embedded = false) => ({
  partId,
  filename,
  mimeType: contentType,
  body: {
    size: bytes.length,
    ...(embedded ? { data: Buffer.from(bytes).toString('base64url') } : { attachmentId: `att-${partId}`, data: '' }),
  },
})

test('connected Gmail attachments download into the requested folder and reach the real document reader', async () => {
  const root = await mkdtemp('/tmp/sky-email-download-test-')
  const requested = path.join(root, 'requested')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Document', 'Amount'],
      ['Atlas', 123.45],
    ]),
    'Summary',
  )
  const sheet = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const messages = [
    message([
      part('1', '../../Atlas.pdf', 'application/pdf', pdf),
      part('2', 'Checklist.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sheet, true),
    ]),
  ]
  const requests: Array<{ method: string; account: string; pathname: string }> = []
  try {
    await withGmail(
      (url, init) => {
        const account = mailboxOf(init)
        requests.push({ method: init?.method ?? 'GET', account, pathname: url.pathname })
        if (account !== 'jane@example.com') return new Response('{}', { status: 404 })
        return url.pathname.endsWith('/attachments/att-1') ? { data: pdf.toString('base64url') } : { messages }
      },
      async (context) => {
        await addGmailAccount(context, 'bob@example.com')
        const inventory = await new Read().run(
          commandArgs(context, { thread: 'ff', account: undefined, message: undefined, offset: undefined }),
        )
        const input = { ...args(requested), account: inventory.data!.account }
        const first = await new Download().run(commandArgs(context, input))
        const retry = await new Download().run(commandArgs(context, input))
        const inspected = await Promise.all(
          first.data!.files.map((file) =>
            readFile(
              { path: file.path },
              {
                cwd: root,
                today: new PlainDate('2026-01-27'),
                attachmentsRoot: path.join(root, 'notebook'),
                onAttachments: () => {},
              },
            ),
          ),
        )
        const pdfRead = inspected[0]!
        const pdfModel =
          pdfRead.output.success && pdfRead.document ? toModelContent(pdfRead.output, pdfRead.document) : undefined
        assert({
          given: 'two connected accounts, a remotely stored PDF and an embedded spreadsheet',
          should:
            'find the owner, preserve bytes, sanitize names, deduplicate retries and hand both formats to chat for inspection',
          actual: [
            first.ok,
            retry.ok,
            first.data?.account,
            first.data!.files.map((file) => path.basename(file.path)),
            retry.data!.files.map((file) => file.path),
            (await readBytes(first.data!.files[0]!.path)).equals(pdf),
            inspected.map((item) => item.output.success && item.output.kind),
            inspected[1]?.document?.kind === 'text' && inspected[1].document.text.includes('Atlas,123.45'),
            pdfModel?.type === 'content' &&
              pdfModel.value.some((part) => part.type === 'file' && part.mediaType === 'application/pdf'),
            (await readdir(requested)).sort(),
            requests.every((request) => request.method === 'GET'),
            requests
              .filter((request) => request.pathname.includes('/attachments/'))
              .every((request) => request.account === 'jane@example.com'),
          ],
          expected: [
            true,
            true,
            'jane@example.com',
            ['Atlas.pdf', 'Checklist.xlsx'],
            first.data!.files.map((file) => file.path),
            true,
            ['pdf', 'text'],
            true,
            true,
            ['Atlas.pdf', 'Checklist.xlsx'],
            true,
            true,
          ],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing or invalid destination cannot silently download into the notebook', async () => {
  const root = await mkdtemp('/tmp/sky-email-default-test-')
  let requests = 0
  try {
    await withGmail(
      () => {
        requests++
        return { messages: [message([part('1', 'Atlas.txt', 'text/plain', Buffer.from('Example'), true)])] }
      },
      async (context) => {
        const scoped = context.fork({ config: { ...context.config, DIR_ATTACHMENTS: root } })
        const results = await Promise.all(
          [undefined, '', '  ', '\0'].map((directory) =>
            new Download().run(commandArgs(scoped, { ...args(root), directory: directory as string })),
          ),
        )
        assert({
          given: 'a model or caller omits the destination or passes an unusable one',
          should: 'require the task folder in the tool schema and refuse before accessing Gmail or writing files',
          actual: [
            commandDescriptionToSchema(Download.description).required?.includes('directory'),
            results.every((result) => result.failed),
            requests,
            await readdir(root),
          ],
          expected: [true, true, 0, []],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('different attachments sharing a filename preserve existing files and reuse their numbered copies', async () => {
  const root = await mkdtemp('/tmp/sky-email-collision-test-')
  const one = Buffer.from('first attachment')
  const two = Buffer.from('second attachment')
  await writeFile(path.join(root, 'Atlas.txt'), 'existing original')
  try {
    await withGmail(
      () => ({
        messages: [
          message([part('1', 'Atlas.txt', 'text/plain', one, true), part('2', 'Atlas.txt', 'text/plain', two, true)]),
        ],
      }),
      async (context) => {
        const results = await Promise.all(
          Array.from({ length: 2 }, () => new Download().run(commandArgs(context, args(root)))),
        )
        assert({
          given: 'concurrent retries of different attachments with the same filename',
          should: 'preserve the original and create exactly one verified copy per distinct attachment',
          actual: [
            results.every((result) => result.ok),
            (await readdir(root)).sort(),
            await readBytes(path.join(root, 'Atlas.txt'), 'utf8'),
            await Promise.all(
              results.flatMap((result) => result.data!.files.map((file) => readBytes(file.path, 'utf8'))),
            ),
          ],
          expected: [
            true,
            ['Atlas.txt', 'Atlas_2.txt', 'Atlas_3.txt'],
            'existing original',
            ['first attachment', 'second attachment', 'first attachment', 'second attachment'],
          ],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('partial attachment failures retain successful paths and permit retrying only the failed part', async () => {
  const root = await mkdtemp('/tmp/sky-email-partial-test-')
  const requests: string[] = []
  let repaired = false
  try {
    await withGmail(
      (url) => {
        requests.push(url.pathname)
        if (url.pathname.endsWith('/attachments/att-2'))
          return { data: Buffer.from(repaired ? 'second' : 'short').toString('base64url') }
        if (url.pathname.endsWith('/attachments/att-3')) return {}
        return {
          messages: [
            message([
              part('1', 'First.txt', 'text/plain', Buffer.from('first'), true),
              part('2', 'Second.txt', 'text/plain', Buffer.from('second')),
              part('3', 'Third.txt', 'text/plain', Buffer.from('third')),
            ]),
          ],
        }
      },
      async (context) => {
        const initial = await new Download().run(commandArgs(context, args(root)))
        repaired = true
        const retry = await new Download().run(commandArgs(context, { ...args(root), message: 'm1', part: '2' }))
        assert({
          given: 'a good attachment, truncated bytes, and a response missing its data',
          should: 'keep good files, name every failed part, and save only the selected part on retry',
          actual: [
            initial.failed,
            initial.data?.complete,
            initial.data?.files.map((file) => file.filename),
            initial.data?.errors.map((file) => [
              file.partId,
              file.error.includes(file.partId === '2' ? 'Incomplete attachment' : 'no attachment data'),
            ]),
            retry.ok,
            retry.data?.files.map((file) => file.filename),
            (await readdir(root)).sort(),
            requests.filter((request) => request.endsWith('/attachments/att-3')).length,
          ],
          expected: [
            true,
            false,
            ['First.txt'],
            [
              ['2', true],
              ['3', true],
            ],
            true,
            ['Second.txt'],
            ['First.txt', 'Second.txt'],
            1,
          ],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('attachment selection rejects unrelated messages and parts before any download', async () => {
  const root = await mkdtemp('/tmp/sky-email-selection-test-')
  let downloads = 0
  try {
    await withGmail(
      (url) => {
        if (url.pathname.includes('/attachments/')) downloads++
        return { messages: [message([part('1', 'Atlas.pdf', 'application/pdf', pdf)])] }
      },
      async (context) => {
        const invalid = await Promise.all(
          [
            { message: undefined, part: '1' },
            { message: 'unrelated', part: '1' },
            { message: 'm1', part: 'missing' },
          ].map((selection) => new Download().run(commandArgs(context, { ...args(root), ...selection }))),
        )
        assert({
          given: 'selectors not belonging to the fetched thread',
          should: 'reject them without fetching arbitrary attachment IDs or writing files',
          actual: [invalid.every((result) => !result.ok), downloads, await readdir(root)],
          expected: [true, 0, []],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Stop retains completed attachments and reports unsaved parts without fetching more', async () => {
  const root = await mkdtemp('/tmp/sky-email-stop-test-')
  const controller = new AbortController()
  let downloads = 0
  try {
    await withGmail(
      (url) => {
        if (url.pathname.includes('/attachments/')) {
          downloads++
          controller.abort()
          return { data: pdf.toString('base64url') }
        }
        return {
          messages: [
            message([
              part('1', 'First.pdf', 'application/pdf', pdf, true),
              part('2', 'Second.pdf', 'application/pdf', pdf),
              part('3', 'Third.pdf', 'application/pdf', pdf),
            ]),
          ],
        }
      },
      async (context) => {
        const result = await new Download().run(commandArgs(context.fork({ signal: controller.signal }), args(root)))
        assert({
          given: 'Stop while the second attachment is being fetched',
          should: 'retain the first file and identify unsaved files for a later retry',
          actual: [
            result.failed,
            result.data?.cancelled,
            result.data?.files.map((file) => file.filename),
            result.data?.errors.map((file) => file.filename),
            downloads,
            await readdir(root),
          ],
          expected: [true, true, ['First.pdf'], ['Second.pdf', 'Third.pdf'], 1, ['First.pdf']],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
