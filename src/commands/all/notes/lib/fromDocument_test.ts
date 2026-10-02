import { mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { buildDayRecord } from '#service/handler/day/record.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { documentWorkWhen } from './documentInput.ts'
import { notesFromDocument } from './fromDocument.ts'

const DAY = new PlainDate('2026-01-27')

test('image notes save every original before reading, and retry the retained pages without losing edits', async () => {
  const { root, options, notes } = await fixture()
  try {
    const sources = ['Atlas-2.heic', 'Atlas-1.png'].map((name) => path.join(root, name))
    for (const [index, source] of sources.entries()) {
      await writeFile(source, `synthetic page ${2 - index}`)
      await utimes(source, 1_700_000_000 + 2 - index, 1_700_000_000 + 2 - index)
    }
    let calls = 0
    const text =
      '## Atlas plan\n\n- [ ] Ship Widget-V2\n- [x] Review scope\n\n| Item | Count |\n| --- | --- |\n| Widgets | 12 |\n\n[illegible]'
    const capture = {
      ...options,
      source: sources,
      transcribe: async (files: string[]) => {
        calls++
        assert({
          given: 'reading a group of note images',
          should: 'already have a saved note and every original in capture order',
          actual: [(await readdir(notes)).length, await Promise.all(files.map((file) => readFile(file, 'utf8')))],
          expected: [1, ['synthetic page 1', 'synthetic page 2']],
        })
        if (calls === 1) throw new Error('Synthetic read timeout')
        return { title: 'Atlas launch plan and widget counts', body: text }
      },
      summarize: async () => {
        throw new Error('Image notes must preserve their full text')
      },
    }
    const failed = await notesFromDocument(capture)
    assert({
      given: 'a failed image read',
      should: 'keep the note available',
      actual: [failed.ok, Boolean(failed.data?.filePath)],
      expected: [false, true],
    })
    const notePath = failed.data!.filePath
    const saved = Document.fromMarkdown(await readFile(notePath, 'utf8'))
    await writeFile(
      notePath,
      new Document(
        {
          ...saved.yaml,
          attachments: [{ file: 'Atlas-1.png', rel: 'Atlas', caption: 'Keep this caption.' }, { file: 'Atlas-2.heic' }],
        },
        `${saved.markdown}\nA manual correction.\n`,
      ).toMarkdown(),
    )
    await Promise.all(sources.map((source) => rm(source)))
    const retried = await notesFromDocument(capture)
    const repeated = await notesFromDocument(capture)
    const note = Document.fromMarkdown(await readFile(notePath, 'utf8'))
    const attachDir = path.join(options.config.DIR_ATTACHMENTS, dayAttachmentsDir(DAY))
    const day = await readFile(path.join(options.config.DIR_TIME, dayFile(DAY)), 'utf8')
    assert({
      given: 'retrying after the staged images are gone and the note has been edited',
      should: 'read retained originals once, preserve the markdown and edits, and keep one timed day entry',
      actual: [
        retried.ok,
        repeated.ok,
        calls,
        (await readdir(notes)).length,
        note.attachments.map(({ file }) =>
          /^\d{4}-\d{2}-\d{2}_\d{6}_Atlas-launch-plan-and-widget-counts-[12]\.(png|heic)$/.test(file),
        ),
        note.yaml.when,
        note.markdown.includes(text),
        note.markdown.includes('A manual correction.'),
        note.markdown.split(text).length - 1,
        day.split(path.basename(notePath)).length - 1,
      ],
      expected: [true, true, 2, 1, [true, true], options.when, true, true, 1, 1],
    })
    assert({
      given: 'the image note finishing and then being retried again',
      should: 'rename every retained file, update its link, preserve metadata and leave no obsolete copies',
      actual: [
        (await readdir(attachDir)).sort(),
        await Promise.all(note.attachments.map(({ file }) => readFile(path.join(attachDir, file), 'utf8'))),
        note.yaml.attachments,
      ],
      expected: [
        note.attachments.map(({ file }) => file).sort(),
        ['synthetic page 1', 'synthetic page 2'],
        [
          { file: note.attachments[0].file, rel: 'Atlas', caption: 'Keep this caption.' },
          { file: note.attachments[1].file },
        ],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an interrupted image rename keeps every reference valid and preserves an already shared original', async () => {
  const { root, options } = await fixture()
  try {
    const attachDir = path.join(options.config.DIR_ATTACHMENTS, dayAttachmentsDir(DAY))
    await mkdir(attachDir, { recursive: true })
    const source = path.join(attachDir, 'Atlas.png')
    await writeFile(source, 'synthetic shared image')
    let reads = 0
    let enrichments = 0
    const capture = {
      ...options,
      source,
      transcribe: async () => {
        reads++
        return { title: 'Atlas API launch milestones and checklist', body: '## Launch\n\n- Review Atlas API' }
      },
      enrich: async () => {
        if (++enrichments === 1) throw new Error('Synthetic enrichment timeout')
        return {}
      },
    }
    const failed = await notesFromDocument(capture)
    const pending = Document.fromMarkdown(await readFile(failed.data!.filePath, 'utf8'))
    assert({
      given: 'a failure after choosing the image filename but before updating the note',
      should: 'keep the saved attachment link readable',
      actual: [failed.ok, await readFile(path.join(attachDir, pending.attachments[0].file), 'utf8')],
      expected: [false, 'synthetic shared image'],
    })
    const retried = await notesFromDocument(capture)
    const repeated = await notesFromDocument(capture)
    const note = Document.fromMarkdown(await readFile(retried.data!.filePath, 'utf8'))
    const name = note.attachments[0].file
    assert({
      given: 'retrying after a partial image rename',
      should: 'reuse the chosen name and readback, finish its attachment link once, and retain the shared source',
      actual: [
        retried.ok,
        repeated.ok,
        reads,
        enrichments,
        /^\d{4}-\d{2}-\d{2}_\d{6}_Atlas-API-launch-milestones-and-checklist\.png$/.test(name),
        (await readdir(attachDir)).sort(),
        await readFile(source, 'utf8'),
        await readFile(path.join(attachDir, name), 'utf8'),
      ],
      expected: [
        true,
        true,
        1,
        2,
        true,
        ['Atlas.png', name].sort(),
        'synthetic shared image',
        'synthetic shared image',
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
    tags: 'Reference; Planning',
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
        should: 'already have one note, its chosen tags, and the original PDF saved',
        actual: [
          saved.length,
          Document.fromMarkdown(await readFile(path.join(notes, saved[0]), 'utf8')).yaml.tags,
          await readFile(file!, 'utf8'),
        ],
        expected: [1, 'Reference; Planning', '%PDF-1.4 synthetic report'],
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
    const third = await notesFromDocument({ ...options, summary: undefined, body: undefined, run: 'third-capture' })
    assert({
      given: 'archiving the same document without an activity description',
      should: 'create a separate note with a neutral title and reuse the attachment',
      actual: [
        Boolean(third.ok),
        (await readdir(notes)).length,
        Document.fromMarkdown(await readFile(third.data!.filePath, 'utf8')).yaml.attachments,
        Document.fromMarkdown(await readFile(third.data!.filePath, 'utf8')).yaml.summary,
      ],
      expected: [true, 3, [{ file: 'Atlas-report_2.pdf' }], 'Atlas report'],
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
