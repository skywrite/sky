import { assert, test } from '#test'
import dayDirDate, { isDayDirName } from './dayDirDate.ts'

const TIME = '/notebook/time'

function ymd(dir: string): string | null {
  return dayDirDate(`${TIME}/${dir}`)?.ymd ?? null
}

test('dayDirDate: reads a day directory in every layout the notebook has written', () => {
  assert({
    given: 'a v1.1 day dir under a week range',
    should: 'return its date',
    expected: '2026-03-13',
    actual: ymd('2026/03/09-15/03-13'),
  })
  assert({
    given: 'a v2 day dir under a bare week number',
    should: 'return its date',
    expected: '2026-03-13',
    actual: ymd('2026/W11/03-13'),
  })
  assert({
    given: 'a v2 day dir under a month-labeled week',
    should: 'return its date',
    expected: '2026-03-13',
    actual: ymd('2026/03-W11/03-13'),
  })
  assert({
    given: 'a legacy DD day dir',
    should: 'take the month from the path',
    expected: '2020-06-17',
    actual: ymd('2020/06/15-21/17'),
  })
  assert({
    given: 'a legacy xDD spillover day in a cross-month week',
    should: 'file it in the following month',
    expected: '2020-04-02',
    actual: ymd('2020/03/30-05/x02'),
  })
  assert({
    given: 'a v1.1 year-boundary artifact - a January day under a December week',
    should: 'arbitrate the year by the week range',
    expected: '2026-01-02',
    actual: ymd('2025/12/29-04/01-02'),
  })
})

test('dayDirDate: a day dir needs no day.md', () => {
  assert({
    given: 'a day dir path that exists only as a string - nothing on disk',
    should: 'still read as a day directory',
    expected: '2026-03-14',
    actual: ymd('2026/03/09-15/03-14'),
  })
})

test('dayDirDate: day-shaped names that are not day directories come back null', () => {
  assert({
    given: 'a v1.1 month directory (two digits, like a legacy DD)',
    should: 'return null',
    expected: null,
    actual: ymd('2026/03'),
  })
  assert({
    given: 'a one-day week range (looks like MM-DD)',
    should: 'return null',
    expected: null,
    actual: ymd('2017/01/01-01'),
  })
  assert({
    given: 'an ordinary v1.1 week range',
    should: 'return null',
    expected: null,
    actual: ymd('2026/03/09-15'),
  })
  assert({
    given: 'a digit-named directory nested inside a v2 day',
    should: 'return null - content of the day, not a day',
    expected: null,
    actual: ymd('2026/W11/03-13/actions/05'),
  })
  assert({
    given: 'an MM-DD directory nested inside a v1.1 day',
    should: 'return null',
    expected: null,
    actual: ymd('2026/03/09-15/03-13/journal/03-13'),
  })
  assert({
    given: 'a week-level directory',
    should: 'return null',
    expected: null,
    actual: ymd('2026/W11/_tracking'),
  })
  assert({
    given: 'a week directory',
    should: 'return null',
    expected: null,
    actual: ymd('2026/W11'),
  })
})

test('isDayDirName: the day-dir shapes across layouts', () => {
  assert({
    given: 'MM-DD, DD, xDD, and the non-day names beside them',
    should: 'accept the three day shapes only',
    expected: [true, true, true, false, false, false, false],
    actual: ['03-13', '22', 'x02', '_tracking', 'W11', '2026', '03-W11'].map(isDayDirName),
  })
})
