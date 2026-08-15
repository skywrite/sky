import picocolors from 'picocolors'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildYearGrid, renderYearGrid } from './yearGrid.ts'

const plain = picocolors.createColors(false)
const ansi = picocolors.createColors(true)

function monthWeekNumbers(year: number): number[][] {
  return buildYearGrid(year)
    .flatMap((q) => q.months)
    .map((m) => m.weeks.map((w) => w.number))
}

test('buildYearGrid - 2026 buckets every week under the month of its first in-year day', () => {
  assert({
    given: '2026 (starts Thursday, genuine ISO W53)',
    should: 'file each week by first day, cross-month weeks staying on their start row',
    actual: JSON.stringify(monthWeekNumbers(2026)),
    expected: JSON.stringify([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9],
      [10, 11, 12, 13, 14],
      [15, 16, 17, 18],
      [19, 20, 21, 22],
      [23, 24, 25, 26, 27],
      [28, 29, 30, 31],
      [32, 33, 34, 35, 36],
      [37, 38, 39, 40],
      [41, 42, 43, 44],
      [45, 46, 47, 48, 49],
      [50, 51, 52, 53],
    ]),
  })
})

test('buildYearGrid - W00 bucket lands on the Jan row', () => {
  const jan = buildYearGrid(2027)[0].months[0]

  assert({
    given: '2027 (Jan 1 is a Friday, so W00 holds Jan 1-3)',
    should: 'start the Jan row at W00',
    actual: JSON.stringify(jan.weeks.map((w) => w.number)),
    expected: JSON.stringify([0, 1, 2, 3, 4]),
  })
  assert({
    given: '2027-W00 in-year extent',
    should: 'clip to Jan 1-3',
    actual: `${jan.weeks[0].startInYear.ymd} ${jan.weeks[0].endInYear.ymd}`,
    expected: '2027-01-01 2027-01-03',
  })
})

test('renderYearGrid - 2026 rows, plain colors', () => {
  const lines = renderYearGrid(2026, { today: new PlainDate(2026, 8, 15), colors: plain })

  assert({
    given: 'the header',
    should: 'name the year, week span, and count',
    actual: lines[0],
    expected: '  2026 · W01–W53 · 53 weeks',
  })
  assert({
    given: 'the now line',
    should: 'carry the current week, date, and weeks left',
    actual: lines[1],
    expected: '  now W33 · Sat Aug 15 · 20 weeks left',
  })
  assert({
    given: 'the Jul row (first month of Q3)',
    should: 'open the quarter bracket',
    actual: lines[11],
    expected: '     ╭  Jul   W28 06–12  W29 13–19  W30 20–26  W31 27–02',
  })
  assert({
    given: 'the Aug row (middle month of Q3)',
    should: 'carry the quarter label and the cross-month W36 cell',
    actual: lines[12],
    expected: '  Q3 │  Aug   W32 03–09  W33 10–16  W34 17–23  W35 24–30  W36 31–06',
  })
  assert({
    given: 'the Dec row',
    should: 'close Q4 with the genuine ISO W53 clipped to Dec 31',
    actual: lines[17],
    expected: '     ╰  Dec   W50 07–13  W51 14–20  W52 21–27  W53 28–31',
  })
})

test('renderYearGrid - 54-week year and overflow W53 bucket', () => {
  const lines2012 = renderYearGrid(2012, { colors: plain })

  assert({
    given: '2012 (Jan 1 Sunday leap year: W00 and W53 are both single days)',
    should: 'count 54 weeks',
    actual: lines2012[0],
    expected: '  2012 · W00–W53 · 54 weeks',
  })
  assert({
    given: "2012's Dec row",
    should: 'end in the one-day W53 bucket',
    actual: lines2012[lines2012.length - 1],
    expected: '     ╰  Dec   W49 03–09  W50 10–16  W51 17–23  W52 24–30  W53 31–31',
  })
})

test('renderYearGrid - now emphasis only when today falls in the rendered year', () => {
  const today = new PlainDate(2026, 8, 15)
  const currentYear = renderYearGrid(2026, { today, colors: ansi }).join('\n')
  const otherYear = renderYearGrid(2025, { today, colors: ansi }).join('\n')

  assert({
    given: 'today inside the rendered year',
    should: 'paint the current-week tile (bgGreen)',
    actual: currentYear.includes('\x1b[42m'),
    expected: true,
  })
  assert({
    given: 'today outside the rendered year',
    should: 'render neutral - no tile, no now line',
    actual: `${otherYear.includes('\x1b[42m')} ${otherYear.includes('now')}`,
    expected: 'false false',
  })
})
