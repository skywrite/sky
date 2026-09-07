import path from 'node:path'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import weekDir from '#shared/nbfs/weekDir.ts'
import { assert, test } from '#test'
import { loadVoiceInitialContext } from './initialContext.ts'

const CONFIG = {
  DIR_BASE: '/Notebook',
  DIR_TIME: '/Notebook/time',
  DIR_AI_MEMORY: '/Notebook/ai/memory',
  FILE_ABOUT_ME: '/Notebook/journal/about-me.md',
  FILE_GOALS_PERSONAL: '/Notebook/goals/personal.md',
  FILE_GOALS_PROFESSIONAL: '/Notebook/goals/professional.md',
  PORT_SERVER: 12345,
}
const CLOCK = { notebookDate: '2026-01-27', notebookTime: '09:30', notebookTimezone: 'Europe/London' }
const EMPTY_ENTITIES = { people: [], projects: [], decisions: [], notes: [], unavailable: [] }

function reader(files: Record<string, string>, reads: string[] = []) {
  return async (file: string): Promise<string> => {
    reads.push(file)
    if (files[file] === undefined) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
    return files[file]
  }
}

function memory(slug: string, kind: MemoryEntry['kind'], body: string): MemoryEntry {
  return {
    path: `${CONFIG.DIR_AI_MEMORY}/${slug}.md`,
    slug,
    kind,
    body,
    summary: body,
    freshness: '2026-01-25',
    uses: 1,
  }
}

test('voice initial context: local evidence, recent summaries, and entity identities arrive together', async () => {
  const recentSummary = path.join(CONFIG.DIR_TIME, dayDir('2026-01-26'), 'summary.md')
  const recentDay = path.join(CONFIG.DIR_TIME, dayFile('2026-01-26'))
  const fallbackDay = path.join(CONFIG.DIR_TIME, dayFile('2026-01-25'))
  const reads: string[] = []
  const context = await loadVoiceInitialContext(CONFIG, CLOCK, {
    read: reader(
      {
        [CONFIG.FILE_ABOUT_ME]: '---\nname: Jane Doe\n---\nBuilds useful software.',
        [CONFIG.FILE_GOALS_PROFESSIONAL]: '# Goals\nLaunch Atlas with three pilot teams.',
        [path.join(CONFIG.DIR_TIME, weekDir(CLOCK.notebookDate), 'week.md')]: 'Finish the pilot plan this week.',
        [path.join(CONFIG.DIR_TIME, dayFile(CLOCK.notebookDate))]:
          '# Today\nCall the pilot team.\n<!-- hidden metadata -->\n\n## Transcript\nRaw spoken transcript.\n\n## Commitments\nSend the scope tomorrow.',
        [recentSummary]: 'Jane reviewed the pilot scope.',
        [recentDay]: 'Raw day that should not be loaded when a summary exists.',
        [fallbackDay]: 'Fallback day record: drafted the scope.',
      },
      reads,
    ),
    memories: async () => [
      memory('answers', 'preference', 'Lead with a recommendation.'),
      memory('pilot', 'glossary', 'The pilot means Atlas.'),
    ],
    entities: async () => ({
      ...EMPTY_ENTITIES,
      people: [{ source: '/Notebook/people/jane.md', body: 'Jane Doe (aka Jane), engineer at Example Labs.' }],
      decisions: [{ source: '/Notebook/decisions/atlas-scope.md', body: 'Pending: choose the pilot scope.' }],
    }),
  })
  assert({
    given: 'profile, preferences, goals, plans, summaries, and entities',
    should: 'orient voice with source-labelled evidence and notebook time',
    actual: [
      '2026-01-27 09:30 (Europe/London)',
      'Source: journal/about-me.md',
      'Jane Doe',
      'Lead with a recommendation.',
      'last confirmed/updated: 2026-01-25',
      'The pilot means Atlas.',
      'Launch Atlas with three pilot teams.',
      'Finish the pilot plan',
      'Call the pilot team.',
      'Send the scope tomorrow.',
      'Jane reviewed the pilot scope.',
      'Fallback day record',
      'engineer at Example Labs',
      'Pending: choose the pilot scope.',
    ].every((text) => context.includes(text)),
    expected: true,
  })
  assert({
    given: 'a day summary and an embedded transcript',
    should: 'prefer the summary and exclude raw transcript and hidden metadata',
    actual: [reads.includes(recentDay), context.includes('Raw spoken transcript'), context.includes('hidden metadata')],
    expected: [false, false, false],
  })
})

test('voice initial context: large sources cannot crowd out other categories or ship partial preferences', async () => {
  const context = await loadVoiceInitialContext(CONFIG, CLOCK, {
    read: reader({
      [CONFIG.FILE_ABOUT_ME]: 'Long profile sentence.\n'.repeat(10_000),
      [CONFIG.FILE_GOALS_PERSONAL]: 'Spend Fridays learning.',
      [path.join(CONFIG.DIR_TIME, dayFile(CLOCK.notebookDate))]: 'Long day record.\n'.repeat(10_000),
    }),
    memories: async () => [
      memory('too-long', 'preference', 'Incomplete preference must not appear. '.repeat(1000)),
      memory('brief', 'preference', 'Give one concrete next step.'),
      ...Array.from({ length: 100 }, (_, i) =>
        memory(`term-${i}`, 'glossary', `Example term ${i} means a pilot stage.`),
      ),
    ],
    entities: async () => ({
      ...EMPTY_ENTITIES,
      projects: Array.from({ length: 20 }, (_, i) => ({
        source: `/Notebook/projects/open/Atlas-${i}/overview.md`,
        body: `Atlas-${i}\nStatus: open`,
      })),
      decisions: [{ source: '/Notebook/decisions/pilot.md', body: 'Choose a pilot date.' }],
    }),
  })
  assert({
    given: 'oversized profile, day, one oversized preference, and many memories and projects',
    should: 'retain other categories, signal omissions, and remain bounded',
    actual: [
      context.length < 45_000,
      context.includes('Spend Fridays learning.'),
      context.includes('Give one concrete next step.'),
      context.includes('Choose a pilot date.'),
      context.includes('Excerpt truncated'),
      context.includes('records omitted by the preferences budget'),
      context.includes('Incomplete preference must not appear'),
      context.includes('Atlas-19/overview.md'),
      context.includes('Example term 0 means a pilot stage.'),
      context.includes('records omitted by the vocabulary and lessons budget'),
    ],
    expected: [true, true, true, true, true, true, false, true, true, true],
  })
})

test('voice initial context: cleaning a large transcript preserves the omission notice', async () => {
  const context = await loadVoiceInitialContext(CONFIG, CLOCK, {
    read: reader({
      [path.join(CONFIG.DIR_TIME, dayFile(CLOCK.notebookDate))]:
        '# Today\nReview the pilot.\n\n## Transcript\n' +
        'Spoken material. '.repeat(4000) +
        '\n\n## Commitments\nA commitment beyond the read budget.',
    }),
    memories: async () => [memory('oversized', 'preference', 'Visible fragment.\n<!-- ' + 'x'.repeat(40_000))],
    entities: async () => EMPTY_ENTITIES,
  })
  assert({
    given: 'a source whose read budget ends inside a transcript and a preference inside a comment',
    should: 'keep the omission visible without shipping a partial preference',
    actual: [
      context.includes('Review the pilot.'),
      context.includes('Source truncated before parsing; later content omitted.'),
      context.includes('Spoken material.'),
      context.includes('A commitment beyond the read budget.'),
      context.includes('Visible fragment.'),
      context.includes('records omitted by the preferences budget'),
    ],
    expected: [true, true, false, false, false, true],
  })
})

test('voice initial context: unavailable sources leave usable local context with explicit limits', async () => {
  const context = await loadVoiceInitialContext(CONFIG, CLOCK, {
    read: async (file) => {
      if (file === CONFIG.FILE_GOALS_PERSONAL) return 'Make time for learning.'
      if (file === CONFIG.FILE_ABOUT_ME) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' })
      throw Object.assign(new Error('fixture absent'), { code: 'ENOENT' })
    },
    memories: async () => {
      throw new Error('fixture memory offline')
    },
    entities: async () => ({ ...EMPTY_ENTITIES, unavailable: ['Notebook entity service unavailable.'] }),
  })
  assert({
    given: 'a missing notebook service, unreadable profile, failed memories, and missing day records',
    should: 'retain local goals and distinguish unavailable evidence from absence of facts',
    actual: [
      'Make time for learning.',
      'Memory store unavailable.',
      'Notebook entity service unavailable.',
      'Unreadable source: journal/about-me.md',
      'not that no such facts exist',
      '[No records loaded for this section.]',
    ].every((text) => context.includes(text)),
    expected: true,
  })
})
