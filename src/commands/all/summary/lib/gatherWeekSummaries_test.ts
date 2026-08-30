import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { serializeSummaryContext } from './contextRecord.ts'
import gatherWeekSummaries from './gatherWeekSummaries.ts'

// A synthetic Monday-Sunday week: 2026-02-02 is a Monday.
const WEEK_DATES = Array.from({ length: 7 }, (_, i) => new PlainDate('2026-02-02').addDays(i))

const MONDAY = [
  '---',
  'title: Daily Summary',
  'day: 2026-02-02',
  'tags: Summary/Daily',
  'rel:',
  '  - Jane Doe',
  '  - projects/Atlas',
  '---',
  '',
  '# Daily Summary: Feb 2, 2026',
  '',
  '## Done',
  '',
  '- Decided: Atlas kickoff moves to Thursday (with Jane Doe)',
  '',
].join('\n')

const TUESDAY = [
  '---',
  'title: Daily Summary',
  'day: 2026-02-03',
  'tags: Summary/Daily',
  '---',
  '',
  '# Daily Summary: Feb 3, 2026',
  '',
  '## Done',
  '',
  '- Shipped the Atlas draft outline',
  '',
].join('\n')

const BROKEN_YAML = [
  '---',
  'rel: [unclosed',
  '---',
  '',
  '# Daily Summary: Feb 4, 2026',
  '',
  'Body is long enough to pass the stub check.',
  '',
].join('\n')

async function makeTimeDir(): Promise<string> {
  const dir = await makeTempDir()
  const at = (date: PlainDate) => path.join(dir, dayDir(date), 'summary.md')

  const record = serializeSummaryContext({
    scope: 'day',
    budget: 300_000,
    kept: [{ path: 'time/2026/W06/02-02/day.md', tokens: 100, kind: 'day' }],
    skipped: [],
  })
  await outputFile(at(WEEK_DATES[0]), MONDAY + record)
  await outputFile(at(WEEK_DATES[1]), TUESDAY)
  await outputFile(at(WEEK_DATES[2]), BROKEN_YAML)
  await outputFile(at(WEEK_DATES[3]), 'tiny')
  // Friday through Sunday have no summary.md at all
  return dir
}

test('gatherWeekSummaries returns dailies in date order with records stripped', async () => {
  const dir = await makeTimeDir()
  try {
    const { days } = await gatherWeekSummaries(WEEK_DATES, dir)

    assert({
      given: 'a week with two readable daily summaries, one carrying a SUMMARY-CONTEXT record',
      should: 'gather both chronologically and strip the record from the body',
      actual: [
        days.map((d) => d.date.ymd).join(','),
        days[0].body.includes('SUMMARY-CONTEXT'),
        days[0].body.includes('Decided: Atlas kickoff'),
      ].join(' | '),
      expected: '2026-02-02,2026-02-03 | false | true',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherWeekSummaries parses rel from frontmatter, empty when absent', async () => {
  const dir = await makeTimeDir()
  try {
    const { days } = await gatherWeekSummaries(WEEK_DATES, dir)

    assert({
      given: 'one daily with a rel list and one without',
      should: 'surface the rel entries and default to empty',
      actual: [days[0].rel.join(','), days[1].rel.length].join(' | '),
      expected: 'Jane Doe,projects/Atlas | 0',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('gatherWeekSummaries reports skipped dates by reason', async () => {
  const dir = await makeTimeDir()
  try {
    const { skipped } = await gatherWeekSummaries(WEEK_DATES, dir)

    assert({
      given: 'a week with a broken-YAML daily, a stub daily, and three absent days',
      should: 'report each date under its skip reason',
      actual: [
        skipped.yamlError.map((d) => d.ymd).join(','),
        skipped.tiny.map((d) => d.ymd).join(','),
        skipped.missing.map((d) => d.ymd).join(','),
        skipped.unreadable.length,
      ].join(' | '),
      expected: '2026-02-04 | 2026-02-05 | 2026-02-06,2026-02-07,2026-02-08 | 0',
    })
  } finally {
    await rm(dir, { recursive: true })
  }
})
