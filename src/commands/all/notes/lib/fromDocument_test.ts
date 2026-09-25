import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { buildDayRecord } from '#service/handler/day/record.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { documentWorkWhen } from './documentInput.ts'
import { notesFromDocument } from './fromDocument.ts'

const DAY = new PlainDate('2026-01-27')

async function fixture() {
  const root = await makeTempDir({ prefix: 'sky-document-note-' })
  const source = path.join(root, 'Atlas-report.pdf')
  await writeFile(source, '%PDF-1.4 synthetic report')
  const config = {
    DIR_BASE: root,
    DIR_TIME: path.join(root, 'time'),
    DIR_ATTACHMENTS: path.join(root, 'user-data/attachments'),
    DIR_USER_DATA: path.join(root, 'user-data'),
    DIR_STATE: path.join(root, 'state'),
  }
  const options = {
    source,
    config,
    when: '2026-01-27 15:30 - 16:30',
    summary: 'Worked on the Atlas report',
    body: 'Revised the recommendations.',
    category: 'Professional Complete',
    run: 'test-capture',
    stage: () => {},
    summarize: async () => '# Summary: Atlas report\n\n## Key points\n\nThe pilot is ready for review.',
    enrich: async () => ({ tags: 'Strategy; Planning', rel: ['Atlas'] }),
  }
  return { root, options, notes: path.join(config.DIR_TIME, dayDir(DAY), 'actions/notes') }
}

test('document note saves before AI, retries without duplicates, and preserves user edits', async () => {
  const { root, options, notes } = await fixture()
  try {
    let calls = 0
    options.summarize = async (file?: string) => {
      calls++
      const saved = await readdir(notes)
      assert({
        given: 'the summary call starting',
        should: 'already have one note and the original PDF saved',
        actual: [saved.length, await readFile(file!, 'utf8')],
        expected: [1, '%PDF-1.4 synthetic report'],
      })
      throw new Error('Synthetic timeout')
    }
    const failed = await notesFromDocument(options)
    assert({
      given: 'a summary that fails',
      should: 'return the saved note for opening and retrying',
      actual: [failed.ok, Boolean(failed.data?.filePath)],
      expected: [false, true],
    })
    const notePath = failed.data!.filePath
    const existing = Document.fromMarkdown(await readFile(notePath, 'utf8'))
    await writeFile(
      notePath,
      new Document(
        { ...existing.yaml, tags: 'Manual', rel: ['Jane Doe'] },
        `${existing.markdown}\nA correction I made while it ran.\n`,
      ).toMarkdown(),
    )
    options.summarize = async () => {
      calls++
      return '# Summary: Atlas report\n\n## Key points\n\nThe pilot is ready for review.'
    }
    const retried = await notesFromDocument(options)
    const repeated = await notesFromDocument(options)
    const note = Document.fromMarkdown(await readFile(notePath, 'utf8'))
    const dayText = await readFile(path.join(options.config.DIR_TIME, dayFile(DAY)), 'utf8')
    const record = await buildDayRecord({
      day: DAY,
      timeDir: options.config.DIR_TIME,
      dayDirPath: path.join(options.config.DIR_TIME, dayDir(DAY)),
      markdownBaseDir: root,
      ownerNames: [],
    })
    assert({
      given: 'retrying twice after editing the saved note',
      should: 'finish that note once, preserve the edits and range, and place it in Notes',
      actual: {
        paths: [retried.data?.filePath, repeated.data?.filePath],
        files: (await readdir(notes)).length,
        calls,
        when: note.yaml.when,
        tags: note.yaml.tags,
        rel: note.yaml.rel,
        correction: note.markdown.includes('A correction I made while it ran.'),
        summaries: note.markdown.split('## Attachment summary').length - 1,
        dayLinks: dayText.split(path.basename(notePath)).length - 1,
        row: record.notes.map((row) => [row.title, row.when]),
        readable: /^\d{4}-\d{2}-\d{2}_\d{6}_Worked-on-the-Atlas-report\.md$/.test(path.basename(notePath)),
      },
      expected: {
        paths: [notePath, notePath],
        files: 1,
        calls: 2,
        when: options.when,
        tags: 'Manual; Strategy; Planning',
        rel: ['Jane Doe', 'Atlas'],
        correction: true,
        summaries: 1,
        dayLinks: 1,
        row: [[options.summary, '15:30 - 16:30']],
        readable: true,
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('separate document captures retain separate notes and never overwrite a same-named attachment', async () => {
  const { root, options, notes } = await fixture()
  try {
    const first = await notesFromDocument(options)
    await writeFile(options.source, '%PDF-1.4 revised synthetic report')
    const second = await notesFromDocument({ ...options, run: 'another-capture' })
    const firstNote = Document.fromMarkdown(await readFile(first.data!.filePath, 'utf8'))
    const secondNote = Document.fromMarkdown(await readFile(second.data!.filePath, 'utf8'))
    assert({
      given: 'two work sessions using different contents under the same PDF filename',
      should: 'keep both notes and both source versions',
      actual: [
        (await readdir(notes)).length,
        first.data?.filePath !== second.data?.filePath,
        firstNote.yaml.attachments,
        secondNote.yaml.attachments,
      ],
      expected: [2, true, [{ file: 'Atlas-report.pdf' }], [{ file: 'Atlas-report_2.pdf' }]],
    })
    const third = await notesFromDocument({ ...options, run: 'third-capture' })
    assert({
      given: 'a new session with the same contents and title',
      should: 'create a separate note and reuse the attachment',
      actual: [
        Boolean(third.ok),
        (await readdir(notes)).length,
        Document.fromMarkdown(await readFile(third.data!.filePath, 'utf8')).yaml.attachments,
      ],
      expected: [true, 3, [{ file: 'Atlas-report_2.pdf' }]],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('document work times preserve extended hours and reject impossible dates and ranges', () => {
  const invalid = [
    '2026-02-30 15:30 - 16:30',
    '2026-01-27 15:60 - 16:30',
    '2026-01-27 15:30 - 14:30',
    '2026-01-27',
    '2026-01-27 23:30 - 00:30',
  ]
  const rejected = invalid.map((value) => {
    try {
      documentWorkWhen(value)
      return false
    } catch {
      return true
    }
  })
  const late = documentWorkWhen('2026-01-27 23:30 – 25:30')
  assert({
    given: 'extended-hour work and invalid ranges',
    should: 'retain the stated day and validate both ends',
    actual: [late.toString(), late.durationMinutes, rejected],
    expected: ['2026-01-27 23:30 - 25:30', 120, invalid.map(() => true)],
  })
})
