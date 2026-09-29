import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import type { MultiselectPrompt, Prompter } from '#commands/lib/prompt/Prompter.ts'
import { UnattendedPrompter } from '#commands/lib/prompt/UnattendedPrompter.ts'
import * as config from '#config'
import { makeTempDir } from '#shared/fs/mod.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { Instant, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { fileRecordedJournal, recordingTypeMenu } from './recordedJournal.ts'
import { sectionsFromStarts } from './recordedSections.ts'

const WHEN = new PlainDateTime('2031-03-16 08:00')
const NOW = new ZonedDateTime('2031-03-16 09:12:34', 'UTC')
const SPEECH = 'I slept well last night. Jane Doe helped me with Atlas. I feel rested after walking.'
const SECTIONS = [
  { heading: 'Sleep', body: 'I slept well last night.', words: 5 },
  { heading: 'Help with Atlas', body: 'Jane Doe helped me with Atlas.', words: 6 },
  { heading: 'Walking', body: 'I feel rested after walking.', words: 5 },
]
const GROUPS = [
  { title: 'Rest', summary: 'Sleep and walking helped.', journalType: 'Health', sections: [0, 2] },
  { title: 'Support', summary: 'Grateful for help with Atlas.', journalType: 'Gratitude', sections: [1] },
]

async function fixture(answer: string[] | null = ['Health', 'Gratitude']) {
  const base = await makeTempDir({ prefix: 'sky-recorded-journal-' })
  const source = path.join(base, 'recording.m4a')
  await writeFile(source, 'synthetic audio bytes')
  const calls: string[] = []
  let review: MultiselectPrompt | undefined
  const quiet = new UnattendedPrompter()
  const prompt: Prompter = {
    interactive: true,
    text: quiet.text,
    confirm: quiet.confirm,
    select: quiet.select,
    form: quiet.form,
    place: quiet.place,
    multiselect: async (value) => {
      calls.push('review')
      review = value
      return answer
    },
  }
  const context = CommandContext.test(
    { ...config, DIR_BASE: base, DIR_TIME: path.join(base, 'time'), DIR_ATTACHMENTS: path.join(base, 'attachments') },
    { notebookNow: NOW, systemNow: NOW },
  ).fork({ prompt })
  const run = await TranscriptRun.forFile(source, {
    dir: path.join(base, 'runs'),
    now: () => NOW.plainDateTime.toString(),
  })
  const models: NonNullable<Parameters<typeof fileRecordedJournal>[1]> = {
    now: () => Instant.from('2031-03-16T09:12:34Z'),
    organize: async (text) => {
      calls.push('organize')
      assert({ given: 'the organization stage', should: 'receive the corrected words', actual: text, expected: SPEECH })
      return { title: 'Rest And Help With Atlas', summary: 'A good day.', sections: SECTIONS }
    },
    menu: async () => [
      { name: 'Health', count: 3 },
      { name: 'Gratitude', count: 2 },
    ],
    suggest: async () => {
      calls.push('suggest')
      return { groups: structuredClone(GROUPS) }
    },
    group: async (_sections, selected) => {
      calls.push(`group:${selected.join(',')}`)
      return {
        groups: [
          { title: 'Health', summary: 'Sleep and walking helped.', sections: [0, 2] },
          { title: 'Help With The Atlas Project', summary: 'Jane Doe helped.', sections: [1] },
        ],
      }
    },
    name: async (entries) => {
      calls.push('name')
      assert({
        given: 'split entries',
        should: 'name each from only its own words',
        actual: entries.map((entry) => entry.content),
        expected: [SECTIONS[0].body + '\n\n' + SECTIONS[2].body, SECTIONS[1].body],
      })
      return [
        { fileName: '0', summary: 'Feeling Rested After Sleep And Walking' },
        { fileName: '1', summary: 'Grateful For Help With Atlas Today' },
      ]
    },
    tags: async () => undefined,
    rel: async () => undefined,
    scope: async (_names, entry) => (entry.body.includes('Jane Doe') ? ['Jane Doe'] : []),
  }
  const options: Parameters<typeof fileRecordedJournal>[0] = {
    kind: 'Audio',
    source,
    cleanedText: SPEECH,
    rel: ['Jane Doe'],
    when: WHEN,
    run,
    context,
    split: 'auto',
    reviewTypes: true,
  }
  return { base, source, calls, review: () => review, models, options }
}

test('sections are cut from the corrected recording without rewriting or losing any words', () => {
  const text = 'A thought.\n\nAnother thought, then a return. Last thought.'
  const sections = sectionsFromStarts(text, [
    { heading: 'First', firstWords: 'A thought.' },
    { heading: 'Raw Transcript', firstWords: 'Another thought, then' },
    { heading: 'Last', firstWords: 'Last thought.' },
  ])!
  assert({
    given: 'model-selected boundaries',
    should: 'slice the original text and keep downstream-safe headings',
    actual: [sections.map((section) => section.body).join(' '), sections[1].heading],
    expected: [text.replace(/\s+/g, ' '), 'Raw'],
  })
  assert({
    given: 'an invented boundary or a missing opening',
    should: 'reject the plan instead of dropping speech',
    actual: [
      sectionsFromStarts(text, [{ heading: 'Missing', firstWords: 'Not said.' }]),
      sectionsFromStarts(text, [{ heading: 'Late', firstWords: 'Last thought.' }]),
    ],
    expected: [undefined, undefined],
  })
})

test('audio journals review suggested types, reunite returning topics, name each entry and keep one recording', async () => {
  const f = await fixture()
  try {
    const result = await fileRecordedJournal(f.options, f.models)
    const files = result.data?.files ?? []
    const docs = await Promise.all(
      files.map(async (file) => JournalDocument.fromMarkdown(await readFile(file, 'utf8'))),
    )
    const attachments = path.join(f.options.context.config.DIR_ATTACHMENTS, dayAttachmentsDir(WHEN.plainDate))
    assert({
      given: 'two detected types with a return to Health later in the recording',
      should: 'review before naming and save each complete entry',
      actual: [result.ok, f.calls, f.review()?.initial, docs.map((doc) => doc.yaml['summary'])],
      expected: [
        true,
        ['organize', 'suggest', 'review', 'name'],
        ['Health', 'Gratitude'],
        ['Feeling Rested After Sleep And Walking', 'Grateful For Help With Atlas Today'],
      ],
    })
    assert({
      given: 'the saved journals',
      should: 'keep the original audio once and scope related people per entry',
      actual: [
        files.map((file) => path.basename(file)),
        docs.map((doc) => doc.yaml['rel']),
        await readdir(attachments),
        docs.map((doc) => doc.attachments[0]?.file),
      ],
      expected: [
        [
          '2031-03-16_091234_Feeling-Rested-After-Sleep-And-Walking.md',
          '2031-03-16_091234_Grateful-For-Help-With-Atlas-Today.md',
        ],
        [null, ['Jane Doe']],
        ['2031-03-16_091234_Rest-And-Help-With-Atlas.m4a'],
        ['2031-03-16_091234_Rest-And-Help-With-Atlas.m4a', '2031-03-16_091234_Rest-And-Help-With-Atlas.m4a'],
      ],
    })
    assert({
      given: 'filing completed',
      should: 'preserve the source and every spoken section, then remove retry data',
      actual: [
        await readFile(f.source, 'utf8'),
        docs[0].markdown.includes(SECTIONS[0].body) && docs[0].markdown.includes(SECTIONS[2].body),
        docs[1].markdown.includes(SECTIONS[1].body),
        await f.options.run.get('journal'),
      ],
      expected: ['synthetic audio bytes', true, true, null],
    })
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('unchecked topics remain in a separate journal and empty selections preserve the entire recording', async () => {
  for (const selection of [['Health'], []]) {
    const f = await fixture(selection)
    try {
      if (!selection.length)
        f.models.name = async () => [{ fileName: '0', summary: 'A Restful Day With Helpful Company' }]
      const result = await fileRecordedJournal(f.options, f.models)
      const docs = await Promise.all(
        (result.data?.files ?? []).map(async (file) => JournalDocument.fromMarkdown(await readFile(file, 'utf8'))),
      )
      assert({
        given: `${selection.length} selected types`,
        should: 'keep unchecked speech rather than discarding it',
        actual: [
          result.ok,
          docs.length,
          docs.some((doc) => String(doc.tags).includes('Journal/Misc')),
          SECTIONS.every((section) => docs.filter((doc) => doc.markdown.includes(section.body)).length === 1),
        ],
        expected: [true, selection.length ? 2 : 1, true, true],
      })
    } finally {
      await rm(f.base, { recursive: true, force: true })
    }
  }
})

test('a partial journal filing resumes without repeating preparation, copying audio, or overwriting edits', async () => {
  const f = await fixture()
  try {
    let enrichments = 0
    f.models.tags = async () => {
      if (++enrichments === 2) throw new Error('Synthetic interrupted enrichment')
      return undefined
    }
    const first = await fileRecordedJournal(f.options, f.models)
    const saved = first.data!.files[0]
    const edited = (await readFile(saved, 'utf8')) + '\nA later personal edit.\n'
    await writeFile(saved, edited)
    f.models.tags = async () => undefined
    const retry = await fileRecordedJournal(f.options, f.models)
    assert({
      given: 'a run that stopped after saving its first journal',
      should: 'reuse all completed work and preserve the edited first entry',
      actual: [
        first.ok,
        retry.ok,
        retry.data?.files.length,
        retry.data?.files[0] === saved,
        (await readFile(saved, 'utf8')) === edited,
        f.calls,
      ],
      expected: [false, true, 2, true, true, ['organize', 'suggest', 'review', 'name']],
    })
    const journals = await readdir(path.dirname(saved))
    assert({
      given: 'the resumed import',
      should: 'leave exactly two journal files',
      actual: journals.length,
      expected: 2,
    })
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('cancelled type review files nothing and cannot consume the source recording', async () => {
  const f = await fixture(null)
  try {
    const result = await fileRecordedJournal(f.options, f.models)
    assert({
      given: 'a cancelled journal-type review',
      should: 'keep the recording and preparation for retry without filing',
      actual: [result.ok, result.data?.files, f.calls, await readFile(f.source, 'utf8')],
      expected: [false, [], ['organize', 'suggest', 'review'], 'synthetic audio bytes'],
    })
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('journal naming failure has a descriptive fallback and never overwrites an existing filename', async () => {
  const f = await fixture()
  try {
    f.models.name = async () => {
      throw new Error('Synthetic naming failure')
    }
    const prepared = { ...f.options, noAutoRel: true }
    // Reserve the same name the suggested title would use.
    const dir = path.join(f.options.context.config.DIR_TIME, dayDir(WHEN.plainDate), 'journal')
    await mkdir(dir, { recursive: true })
    const existing = path.join(dir, '2031-03-16_091234_Rest.md')
    await writeFile(existing, 'An existing unrelated journal.')
    const result = await fileRecordedJournal(prepared, f.models)
    assert({
      given: 'failed naming and a filename collision',
      should: 'save the journals with a numeric suffix while keeping the existing document',
      actual: [result.ok, path.basename(result.data!.files[0]), await readFile(existing, 'utf8')],
      expected: [true, '2031-03-16_091234_Rest-2.md', 'An existing unrelated journal.'],
    })
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('journal type detection works for an empty notebook and retains custom types', () => {
  const menu = recordingTypeMenu([
    { name: 'Dreams', count: 2 },
    { name: 'Audio', count: 5 },
    { name: 'Self-Improvement', count: 1 },
  ])
  assert({
    given: 'custom types, recording provenance, and an otherwise new notebook',
    should: 'offer useful defaults without duplicating spellings or suggesting Audio as a topic',
    actual: [
      menu[0].name,
      menu.some((item) => item.name === 'Health'),
      menu.some((item) => item.name === 'Audio'),
      menu.filter((item) => item.name.replace('-', ' ') === 'Self Improvement').length,
    ],
    expected: ['Dreams', true, false, 1],
  })
})
