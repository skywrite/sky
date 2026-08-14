import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { planDayRange } from './planContext.ts'

test('planDayRange - mid-week planning of the current week', () => {
  // Planning W33-2026 on Wednesday Aug 12: all of W32 + W33's completed Mon/Tue
  const days = planDayRange(Week.from(2026, 33), new PlainDate(2026, 8, 12))

  assert({
    given: 'target W33, today Wed 2026-08-12',
    should: 'span previous week fully plus Mon and Tue',
    actual: `${days.length}: ${days[0].ymd} .. ${days[days.length - 1].ymd}`,
    expected: '9: 2026-08-03 .. 2026-08-11',
  })
})

test('planDayRange - planning a future week', () => {
  // Planning W34-2026 on Sunday Aug 16: W33 Mon-Sat; Sunday itself is not complete
  const days = planDayRange(Week.from(2026, 34), new PlainDate(2026, 8, 16))

  assert({
    given: 'target W34, today Sun 2026-08-16',
    should: 'contribute only the previous week, minus the in-flight Sunday',
    actual: `${days.length}: ${days[0].ymd} .. ${days[days.length - 1].ymd}`,
    expected: '6: 2026-08-10 .. 2026-08-15',
  })
})
