import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { Instant, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import Export from './export.ts'
import { commandArgs, withGmail } from './lib/testGmail.ts'

const b64 = (text: string) => Buffer.from(text).toString('base64url')
const html =
  '<table><tr><td><a href="https://example.com/view">View in browser</a></td></tr>' +
  '<tr><td><h1>The Atlas Field Guide</h1><p>Most maps are wrong. That’s the <b>point</b>.</p>' +
  '<p>See you next week.</p></td></tr><tr><td><p>Unsubscribe</p></td></tr></table>'
const essay = (id: string) => ({
  id,
  threadId: 'ff',
  // Late evening in New York, already the next day in UTC.
  internalDate: String(Instant.from('2031-03-02T03:30:00Z').epochMilliseconds),
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Subject', value: 'The Atlas Field Guide' },
      { name: 'From', value: 'Jane Doe <jane@example.com>' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Most maps are wrong. That’s the point. See you next week.') } },
      { mimeType: 'text/html', body: { data: b64(html) } },
    ],
  },
})
const exportArgs = (directory: string, overrides: Record<string, unknown> = {}) => ({
  thread: 'ff',
  directory,
  message: undefined as string | undefined,
  title: undefined as string | undefined,
  name: 'Atlas-Field-Guide' as string | undefined,
  author: 'Jane Doe' as string | undefined,
  tags: 'Topic/Subtopic;Other' as string | undefined,
  cadence: '3 months' as string | undefined,
  importance: 7 as number | undefined,
  start: 'Most maps are wrong' as string | undefined,
  end: 'See you next week' as string | undefined,
  account: undefined as string | undefined,
  ...overrides,
})
const notebookNow = new ZonedDateTime('2031-03-13T08:00:00', 'America/New_York')

test('google:email:export files the email’s content, classified, and refuses to file it twice', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-email-export-test-'))
  const folder = path.join(root, 'reading', 'Jane-Doe')
  try {
    await withGmail(
      () => ({ messages: [essay('m1')] }),
      async (context) => {
        const run = (overrides: Record<string, unknown> = {}) =>
          new Export().run(commandArgs(context.fork({ notebookNow }), exportArgs(folder, overrides)))
        const first = await run()

        assert({
          given: 'a newsletter email, start and end words, and the folder’s fields',
          should:
            'write its content between those words under the email subject, dated by the email in the notebook’s zone',
          actual: [first.ok, await readFile(path.join(folder, 'Atlas-Field-Guide.md'), 'utf8')],
          expected: [
            true,
            [
              '---',
              'created: 2031-03-13',
              'authored: 2031-03-01',
              'author: Jane Doe',
              'tags: Topic/Subtopic; Other',
              'cadence: 3 months',
              'importance: 7',
              '---',
              '',
              '# The Atlas Field Guide',
              '',
              'Most maps are wrong. That’s the **point**.',
              '',
              'See you next week.',
              '',
            ].join('\n'),
          ],
        })

        assert({
          given: 'a successful export',
          should: 'return the first and last paragraphs kept, to check the cut',
          actual: [first.data?.begins, first.data?.ends],
          expected: ['Most maps are wrong. That’s the **point**.', 'See you next week.'],
        })

        const again = await run({ name: 'Atlas-Field-Guide-Again' })
        const taken = await run({ title: 'A Different Heading' })

        assert({
          given: 'the same email exported again under another name, then another heading under a taken name',
          should: 'refuse both and leave the one file in place',
          actual: [
            again.failed && !!again.message?.startsWith('Already filed'),
            taken.failed && !!taken.message?.includes('already exists'),
            await readdir(folder),
          ],
          expected: [true, true, ['Atlas-Field-Guide.md']],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('google:email:export writes nothing when it cannot tell what to export', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-email-export-test-'))
  const folder = path.join(root, 'Jane-Doe')
  try {
    await withGmail(
      () => ({ messages: [essay('m1'), essay('m2')] }),
      async (context) => {
        const run = (overrides: Record<string, unknown> = {}) =>
          new Export().run(commandArgs(context.fork({ notebookNow }), exportArgs(folder, overrides)))
        const ambiguous = await run()
        const missing = await run({ message: 'm2', start: 'Widget-V2 launch' })

        assert({
          given: 'a two-message thread without a message, then start words that are not in the email',
          should: 'fail naming the messages, then the missing words, and create nothing',
          actual: [
            ambiguous.failed && !!ambiguous.message?.includes('m1') && !!ambiguous.message?.includes('m2'),
            missing.failed && !!missing.message?.includes('start words were not found'),
            await readdir(root),
          ],
          expected: [true, true, []],
        })
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
