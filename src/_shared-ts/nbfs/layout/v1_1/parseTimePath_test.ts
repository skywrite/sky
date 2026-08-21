import * as path from 'node:path'
import { assert, test } from '#test'
import parseDateFromDayPath from './parseDateFromDayPath.ts'
import parseTimePath from './parseTimePath.ts'

const abs = (rel: string) => path.join('/some/base/path', rel)

test(`${parseTimePath.name} - day paths`, () => {
  const FIXTURES = [
    { path: 'time/2019/04/01-07/04-05/day.md', expected: '2019-04-05' },
    { path: 'time/2021/05/31-06/05-31/meeting-with-bob.md', expected: '2021-05-31' },
    { path: 'time/2021/05/31-06/06-06/standup.md', expected: '2021-06-06' }, // cross-month day
    { path: 'time/2022/01/01-02/01-02/notes/project-ideas.md', expected: '2022-01-02' }, // nested
    { path: 'time/2022/03/28-03/04-02/day.md', expected: '2022-04-02' }, // cross-month day
    { path: 'time/2023/01/01-01/01-01/day.md', expected: '2023-01-01' }, // year-clipped week
  ]

  for (const fixture of FIXTURES) {
    const result = parseTimePath(abs(fixture.path))

    assert({
      given: `day path ${fixture.path}`,
      should: `classify as a single-day span on ${fixture.expected}`,
      actual: result?.kind === 'day' && [result.date, result.start, result.end].map(String).join(' '),
      expected: `${fixture.expected} ${fixture.expected} ${fixture.expected}`,
    })
  }
})

test(`${parseTimePath.name} - agrees with parseDateFromDayPath on day files`, () => {
  const dayPaths = [
    'time/2019/04/01-07/04-05/day.md',
    'time/2021/05/31-06/06-06/standup.md',
    'time/2022/08/29-04/09-01/team-sync.md',
    'time/2022/12/26-31/12-31/day.md',
  ]

  for (const rel of dayPaths) {
    const full = abs(rel)
    const info = parseTimePath(full)

    assert({
      given: `day path ${rel}`,
      should: 'return the same date parseDateFromDayPath returns',
      actual: info?.kind === 'day' ? info.date.toString() : info,
      expected: parseDateFromDayPath(full).toString(),
    })
  }
})

test(`${parseTimePath.name} - week paths`, () => {
  const FIXTURES = [
    { path: 'time/2022/03/21-27/week.md', start: '2022-03-21', end: '2022-03-27' },
    { path: 'time/2022/03/21-27/summary.md', start: '2022-03-21', end: '2022-03-27' },
    { path: 'time/2022/03/28-03/week.md', start: '2022-03-28', end: '2022-04-03' }, // cross-month span
    { path: 'time/2022/12/26-31/week.md', start: '2022-12-26', end: '2022-12-31' }, // year-clipped: 6 days
    { path: 'time/2023/01/01-01/week.md', start: '2023-01-01', end: '2023-01-01' }, // year-clipped: 1 day
  ]

  for (const fixture of FIXTURES) {
    const result = parseTimePath(abs(fixture.path))

    assert({
      given: `week-level path ${fixture.path}`,
      should: `classify as the week span ${fixture.start} - ${fixture.end}`,
      actual: result?.kind === 'week' && `${result.start} ${result.end}`,
      expected: `${fixture.start} ${fixture.end}`,
    })
  }
})

test(`${parseTimePath.name} - month and year paths`, () => {
  const FIXTURES = [
    { path: 'time/2022/03/notes.md', kind: 'month', start: '2022-03-01', end: '2022-03-31' },
    { path: 'time/2022/02/notes.md', kind: 'month', start: '2022-02-01', end: '2022-02-28' },
    { path: 'time/2022/12/notes.md', kind: 'month', start: '2022-12-01', end: '2022-12-31' }, // year rollover in end calc
    { path: 'time/2022/goals.md', kind: 'year', start: '2022-01-01', end: '2022-12-31' },
  ]

  for (const fixture of FIXTURES) {
    const result = parseTimePath(abs(fixture.path))

    assert({
      given: `${fixture.kind}-level path ${fixture.path}`,
      should: `classify as the ${fixture.kind} span ${fixture.start} - ${fixture.end}`,
      actual: result && `${result.kind} ${result.start} ${result.end}`,
      expected: `${fixture.kind} ${fixture.start} ${fixture.end}`,
    })
  }
})

test(`${parseTimePath.name} - non-document and malformed paths return null`, () => {
  const NULL_PATHS = [
    '/some/path/without/a/marker/directory.md', // no time dir
    '/some/base/time', // the time dir itself
    '/some/base/time/2022', // bare year dir
    '/some/base/time/2022/03', // bare month dir
    '/some/base/time/2022/03/21-27', // bare week dir
    '/some/base/time/2022/03/21-27/03-21', // bare day dir
    '/some/base/time/2022/03/21-27/notes/x.md', // unknown depth: not a day dir below the week
    '/some/base/time/2022/03/21-29/week.md', // 9-day range: no real week produces it
    '/some/base/time/2022/13/01-07/week.md', // month 13
    '/some/base/time/2022/03/21-27/21/day.md', // pre-v1.1 bare DD day dir
    '/some/base/time/2022/03/28-03/x02/day.md', // pre-v1.1 x-prefixed day dir
    '/some/base/time/twenty22/03/21-27/week.md', // malformed year
  ]

  for (const p of NULL_PATHS) {
    assert({
      given: `path ${p}`,
      should: 'return null',
      actual: parseTimePath(p),
      expected: null,
    })
  }
})
