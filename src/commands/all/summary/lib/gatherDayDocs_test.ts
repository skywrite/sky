import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import gatherDayDocs from './gatherDayDocs.ts'

const JOURNAL = [
  '---',
  'created: 2026-01-15',
  'tags: Journal',
  '---',
  '',
  '# Health',
  '',
  'Slept well, morning run before sunrise.',
  '',
].join('\n')

const MESSAGE_EARLY = [
  '---',
  'from: Jane Doe',
  'summary: Atlas kickoff',
  '---',
  '',
  '# Atlas kickoff',
  '',
  'Jane: can we lock the Atlas kickoff agenda today?',
  '',
].join('\n')

const MEETING = [
  '---',
  'who: Jane Doe',
  'when: 2026-01-15 07:30 - 08:15',
  'medium: Zoom',
  'summary: Atlas Sync',
  '---',
  '',
  '# Atlas Sync',
  '',
  'Agreed to ship the Atlas draft by Friday.',
  '',
].join('\n')

const CHAT = [
  '---',
  'created: 2026-01-15',
  'summary: Atlas Planning',
  'provider: claude',
  'model: claude-opus-5',
  'turns: 1',
  '---',
  '',
  '# Atlas Planning',
  '',
  '## Sam',
  '',
  'How should we sequence the Atlas rollout?',
  '',
  '## AI Assistant',
  '',
  'Ship the draft first, then review.',
  '',
  '<!--',
  'QUERIES:',
  '',
  ' - { journals(limit: 5) }',
  '',
  'END',
  '-->',
  '',
  '<!-- CONTEXT-LOG',
  '{"version":2,"turns":[{"turn":1,"queries":[]}]}',
  '-->',
  '',
].join('\n')

const MESSAGE_LATE = [
  '---',
  'from: Sam',
  'summary: Late night follow-up',
  '---',
  '',
  '# Late night follow-up',
  '',
  'Sent Jane the revised Atlas outline before bed.',
  '',
].join('\n')

const MESSAGE_UNTIMED = [
  '---',
  'from: Jane Doe',
  'summary: Untimed note',
  '---',
  '',
  '# Untimed note',
  '',
  'No filename prefix and no when field on this one.',
  '',
].join('\n')

const DAY = [
  '---',
  'created: 2026-01-15',
  '---',
  '',
  '# Thursday',
  '',
  '- ~~Ship the Atlas draft~~',
  '- Review Jane Doe notes',
  '',
].join('\n')

const SUMMARY = ['---', 'title: Daily Summary', '---', '', '# Should never be gathered', ''].join('\n')

const BROKEN_YAML = [
  '---',
  'when: [unclosed',
  '---',
  '',
  '# Broken frontmatter',
  '',
  'Body is long enough to pass the stub check.',
  '',
].join('\n')

async function makeDayDir(): Promise<string> {
  const dir = await makeTempDir()
  await outputFile(path.join(dir, 'day.md'), DAY)
  await outputFile(path.join(dir, 'summary.md'), SUMMARY)
  await outputFile(path.join(dir, 'journal/health.md'), JOURNAL)
  await outputFile(path.join(dir, 'actions/messages/06-45_slack_Jane-to-Sam_Atlas-kickoff.md'), MESSAGE_EARLY)
  await outputFile(path.join(dir, 'actions/meetings/Zoom_Jane-Doe_Atlas-Sync.md'), MEETING)
  await outputFile(path.join(dir, 'actions/ai-chats/09-12_Atlas-Planning.md'), CHAT)
  await outputFile(path.join(dir, 'actions/messages/25-30_slack_Sam-to-Jane_Late-night.md'), MESSAGE_LATE)
  await outputFile(path.join(dir, 'actions/messages/slack_Jane-to-Sam_Untimed.md'), MESSAGE_UNTIMED)
  await outputFile(path.join(dir, 'actions/notes/stub.md'), 'tiny')
  await outputFile(path.join(dir, 'actions/notes/broken.md'), BROKEN_YAML)
  return dir
}

test('gatherDayDocs orders journals, then actions chronologically, day.md last', async () => {
  const dir = await makeDayDir()
  try {
    const { docs } = await gatherDayDocs(dir)

    assert({
      given: 'a day directory with journals, timed and untimed actions, and day.md',
      should: 'order journals first, actions by time (filename prefix or when:), day.md last',
      actual: docs.map((d) => path.relative(dir, d.path)).join(' | '),
      expected: [
        'journal/health.md',
        'actions/messages/06-45_slack_Jane-to-Sam_Atlas-kickoff.md',
        'actions/meetings/Zoom_Jane-Doe_Atlas-Sync.md',
        'actions/ai-chats/09-12_Atlas-Planning.md',
        'actions/messages/25-30_slack_Sam-to-Jane_Late-night.md',
        'actions/messages/slack_Jane-to-Sam_Untimed.md',
        'day.md',
      ].join(' | '),
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherDayDocs never clamps extended-hours prefixes', async () => {
  const dir = await makeDayDir()
  try {
    const { docs } = await gatherDayDocs(dir)
    const names = docs.map((d) => path.basename(d.path))

    assert({
      given: 'a 25-30 extended-hours file (late night of the same notebook day)',
      should: 'sort it after the daytime actions, not wrap it to 01-30',
      actual: names.indexOf('25-30_slack_Sam-to-Jane_Late-night.md') > names.indexOf('09-12_Atlas-Planning.md'),
      expected: true,
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherDayDocs strips machine comments from chat transcripts', async () => {
  const dir = await makeDayDir()
  try {
    const { docs } = await gatherDayDocs(dir)
    const chat = docs.find((d) => d.path.includes('ai-chats'))
    const markdown = chat?.doc.toMarkdown() ?? ''

    assert({
      given: 'a chat transcript with CONTEXT-LOG and legacy QUERIES comment blocks',
      should: 'remove the machine comments and keep the conversation',
      actual: [
        markdown.includes('CONTEXT-LOG'),
        markdown.includes('QUERIES'),
        markdown.includes('Ship the draft first'),
      ].join(','),
      expected: 'false,false,true',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherDayDocs excludes summary.md and reports skipped files', async () => {
  const dir = await makeDayDir()
  try {
    const { docs, skipped } = await gatherDayDocs(dir)

    assert({
      given: 'a day directory containing summary.md, a stub file, and a broken-YAML file',
      should: 'gather none of them and report the stub and broken files by reason',
      actual: [
        docs.some((d) => d.path.endsWith('summary.md')),
        skipped.tiny.join(','),
        skipped.yamlError.join(','),
        skipped.unreadable.length,
      ].join(' | '),
      expected: 'false | actions/notes/stub.md | actions/notes/broken.md | 0',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherDayDocs tags each document with its kind', async () => {
  const dir = await makeDayDir()
  try {
    const { docs } = await gatherDayDocs(dir)
    const kindOf = (suffix: string) => docs.find((d) => d.path.endsWith(suffix))?.kind

    assert({
      given: 'gathered day documents',
      should: 'classify journal files, action files, and day.md',
      actual: [kindOf('journal/health.md'), kindOf('09-12_Atlas-Planning.md'), kindOf('day.md')].join(','),
      expected: 'journal,action,day',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherDayDocs returns empty for a missing directory', async () => {
  const { docs, skipped } = await gatherDayDocs('/nonexistent/dir/for/gatherDayDocs')

  assert({
    given: 'a day directory that does not exist',
    should: 'return no documents and no skips',
    actual: [docs.length, skipped.tiny.length, skipped.yamlError.length, skipped.unreadable.length].join(','),
    expected: '0,0,0,0',
  })
})
