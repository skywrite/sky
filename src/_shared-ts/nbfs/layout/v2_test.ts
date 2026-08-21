import { assert, test } from '#test'
import { v2, v2Months } from './v2.ts'

test('v2 weekDir/dayDir - mid-year and cross-month', () => {
  const fixtures = [
    // Mon Mar 30 - Sun Apr 5 2026 is W14; April days stay in the same week
    { date: '2026-03-31', bare: '2026/W14/03-31', labeled: '2026/03-W14/03-31' },
    { date: '2026-04-01', bare: '2026/W14/04-01', labeled: '2026/03-W14/04-01' },
    { date: '2026-04-05', bare: '2026/W14/04-05', labeled: '2026/03-W14/04-05' },
  ]

  for (const { date, bare, labeled } of fixtures) {
    assert({ given: `${date} (bare)`, should: `build ${bare}`, actual: v2.dayDir(date), expected: bare })
    assert({ given: `${date} (labeled)`, should: `build ${labeled}`, actual: v2Months.dayDir(date), expected: labeled })
  }
})

test('v2 weekDir/dayDir - year boundaries split into W00/W53 buckets', () => {
  const fixtures = [
    // 2026 starts Thursday: Jan 1-4 are a W01 stub
    { date: '2026-01-01', bare: '2026/W01/01-01', labeled: '2026/01-W01/01-01' },
    // Dec 29 2025 is ISO 2026-W01, but the year is the boundary: 2025's W53 bucket
    { date: '2025-12-29', bare: '2025/W53/12-29', labeled: '2025/12-W53/12-29' },
    // Jan 1 2027 (Fri) is ISO 2026-W53: 2027's W00 bucket, labeled by its in-year start
    { date: '2027-01-01', bare: '2027/W00/01-01', labeled: '2027/01-W00/01-01' },
    { date: '2026-12-30', bare: '2026/W53/12-30', labeled: '2026/12-W53/12-30' },
    { date: '2027-01-04', bare: '2027/W01/01-04', labeled: '2027/01-W01/01-04' },
  ]

  for (const { date, bare, labeled } of fixtures) {
    assert({ given: `${date} (bare)`, should: `build ${bare}`, actual: v2.dayDir(date), expected: bare })
    assert({ given: `${date} (labeled)`, should: `build ${labeled}`, actual: v2Months.dayDir(date), expected: labeled })
  }
})

test('v2 dayFile appends day.md', () => {
  assert({
    given: '2026-03-31',
    should: 'end in day.md',
    actual: v2.dayFile('2026-03-31'),
    expected: '2026/W14/03-31/day.md',
  })
})

test('v2 parseDateFromDayPath - round-trips both variants from either parser', () => {
  const dates = ['2026-03-31', '2026-04-01', '2025-12-29', '2027-01-01', '2026-12-30']

  for (const date of dates) {
    for (const builder of [v2, v2Months]) {
      const filePath = `time/${builder.dayFile(date)}`
      for (const parser of [v2, v2Months]) {
        assert({
          given: `${filePath} via ${parser.pattern}`,
          should: `parse to ${date}`,
          actual: parser.parseDateFromDayPath(filePath).toString(),
          expected: date,
        })
      }
    }
  }
})

test('v2 parseDateFromDayPath - base prefix and nested files', () => {
  assert({
    given: 'absolute path with base prefix',
    should: 'parse from the time-relative segments',
    actual: v2.parseDateFromDayPath('/nb/time/2026/W14/03-31/day.md').toString(),
    expected: '2026-03-31',
  })
  assert({
    given: 'nested file under the day dir',
    should: 'parse the day dir date',
    actual: v2.parseDateFromDayPath('time/2026/03-W14/04-01/actions/meetings/atlas-sync.md').toString(),
    expected: '2026-04-01',
  })
})

test('v2 parseDateFromDayPath - rejects foreign shapes', () => {
  const bad = [
    'time/2026/03/30-05/03-31/day.md', // v1.1 - month container, DD-DD week
    'time/2026/03/W14/03.31/day.md', // retired dot-format v2
    'notes/2026-03-31.md', // outside the time tree
  ]

  for (const filePath of bad) {
    let threw = false
    try {
      v2.parseDateFromDayPath(filePath)
    } catch {
      threw = true
    }
    assert({ given: filePath, should: 'throw', actual: threw, expected: true })
  }
})

test('v2 parseTimePath - classifies year, week, and day documents', () => {
  const week = v2.parseTimePath('time/2026/W14/week.md')
  assert({
    given: 'a file directly in a week dir',
    should: 'span the week within its year',
    actual: `${week?.kind} ${week?.start} ${week?.end}`,
    expected: 'week 2026-03-30 2026-04-05',
  })

  const labeledWeek = v2Months.parseTimePath('time/2026/03-W14/summary.md')
  assert({
    given: 'a file in a labeled week dir',
    should: 'span the same week',
    actual: `${labeledWeek?.kind} ${labeledWeek?.start} ${labeledWeek?.end}`,
    expected: 'week 2026-03-30 2026-04-05',
  })

  const stub = v2.parseTimePath('time/2027/W00/week.md')
  assert({
    given: 'a W00 stub week doc',
    should: 'clip to the in-year days',
    actual: `${stub?.start} ${stub?.end}`,
    expected: '2027-01-01 2027-01-03',
  })

  const day = v2.parseTimePath('time/2026/W14/04-01/actions/notes/idea.md')
  assert({
    given: 'a file under a day dir',
    should: 'classify as that day',
    actual: day?.kind === 'day' ? `${day.kind} ${day.date}` : `${day?.kind}`,
    expected: 'day 2026-04-01',
  })

  const year = v2.parseTimePath('time/2026/reminders.md')
  assert({
    given: 'a file directly under the year',
    should: 'span the year',
    actual: `${year?.kind} ${year?.start} ${year?.end}`,
    expected: 'year 2026-01-01 2026-12-31',
  })
})

test('v2 parseTimePath - null on bare dirs, foreign shapes, impossible components', () => {
  const nulls = [
    'time/2026', // bare year dir
    'time/2026/W14', // bare week dir
    'time/2026/03-W14/03-31', // bare day dir
    'time/2026/03/30-05/week.md', // v1.1 shape
    'time/2026/W60/week.md', // week that does not exist in 2026
    'time/2026/W14/02-30/day.md', // impossible date
    'library/atlas.md', // outside the time tree
  ]

  for (const filePath of nulls) {
    assert({ given: filePath, should: 'classify as null', actual: v2.parseTimePath(filePath), expected: null })
  }
})
