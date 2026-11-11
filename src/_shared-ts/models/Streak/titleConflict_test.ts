import StreakDocument, {
  computeStreakStats,
  findStreakTitleConflict,
  streaksShareDays,
  streakTitleConflictMessage,
} from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

const ended = { title: 'Eat clean', start: '2026-01-05', end: '2026-02-28' }

test('streaksShareDays()', () => {
  assert({
    given: 'the same title starting the day after the earlier streak ended',
    should: 'keep the two apart',
    actual: streaksShareDays(ended, { title: 'Eat clean', start: '2026-03-01' }),
    expected: false,
  })
  assert({
    given: 'the same title starting on the earlier streak’s last day',
    should: 'share that day',
    actual: streaksShareDays(ended, { title: 'Eat clean', start: '2026-02-28' }),
    expected: true,
  })
  assert({
    given: 'the same title planned to end before the other one starts',
    should: 'keep the two apart, whichever is passed first',
    actual: [
      streaksShareDays({ title: 'Eat clean', start: '2025-11-01', end: '2026-01-04' }, ended),
      streaksShareDays(ended, { title: 'Eat clean', start: '2025-11-01', end: '2026-01-04' }),
    ],
    expected: [false, false],
  })
  assert({
    given: 'the same title with different capitalization and spacing on shared days',
    should: 'still count as one title',
    actual: streaksShareDays(ended, { title: '  EAT CLEAN ', start: '2026-02-01' }),
    expected: true,
  })
  assert({
    given: 'an earlier streak that has no end yet',
    should: 'share every day from its start on',
    actual: streaksShareDays({ title: 'Eat clean', start: '2026-01-05' }, { title: 'Eat clean', start: '2027-06-01' }),
    expected: true,
  })
  assert({
    given: 'a streak with no readable start',
    should: 'stay in the way, because dates cannot tell the two apart',
    actual: streaksShareDays({ title: 'Eat clean', start: null, end: '2026-02-28' }, ended),
    expected: true,
  })
  assert({
    given: 'different titles on the same days',
    should: 'never conflict',
    actual: streaksShareDays(ended, { title: 'Eat clean at lunch', start: '2026-01-05' }),
    expected: false,
  })
})

test('findStreakTitleConflict() and its message', () => {
  const earlier = { title: 'Eat clean', start: '2025-06-01', end: '2025-08-31' }
  assert({
    given: 'a start after every earlier streak with that title has ended',
    should: 'find nothing in the way',
    actual: findStreakTitleConflict({ title: 'Eat clean', start: '2026-03-01' }, [earlier, ended]),
    expected: undefined,
  })
  const conflict = findStreakTitleConflict({ title: 'eat clean', start: '2026-02-10' }, [earlier, ended])
  assert({
    given: 'a start inside an ended streak’s dates',
    should: 'name that streak and the first free day',
    actual: conflict,
    expected: { title: 'Eat clean', through: '2026-02-28', freeFrom: '2026-03-01' },
  })
  assert({
    given: 'that conflict, read after and before the earlier streak’s end',
    should: 'say when the title is free, in the surface’s own word for it',
    actual: [
      streakTitleConflictMessage(conflict!, '2026-04-01'),
      streakTitleConflictMessage(conflict!, '2026-02-20', 'title'),
    ],
    expected: [
      '“Eat clean” ran through 2026-02-28. Start on 2026-03-01 or later, or choose a different name.',
      '“Eat clean” runs through 2026-02-28. Start on 2026-03-01 or later, or choose a different title.',
    ],
  })
  const open = findStreakTitleConflict({ title: 'Eat clean', start: '2026-03-01' }, [
    ended,
    { title: 'Eat clean', start: '2026-02-01' },
  ])
  assert({
    given: 'a streak with that title that has no end',
    should: 'offer only a different name, because no later start is free',
    actual: [open, streakTitleConflictMessage(open!, '2026-04-01')],
    expected: [{ title: 'Eat clean' }, 'A streak already uses this name. Choose a different name.'],
  })
})

test('two streaks that reuse a title count only their own days', () => {
  const rule = (name: string, start: string, end?: string) =>
    StreakDocument.create({
      name,
      title: 'Eat clean',
      start: new PlainDate(start),
      end: end ? new PlainDate(end) : undefined,
    })
  const first = rule('eat-clean', '2026-03-02', '2026-03-04')
  const second = rule('eat-clean-2', '2026-03-06')
  const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'].map((ymd) => ({
    day: new PlainDate(ymd),
    items: [ymd === '2026-03-05' ? 'Eat clean' : '~~Eat clean~~'],
  }))
  const today = new PlainDate('2026-03-07')
  assert({
    given: 'an ended streak and a later one with the same title, read from the same day files',
    should: 'report no shared days and give each its own run',
    actual: [
      streaksShareDays(first.span, second.span),
      first.span,
      [computeStreakStats(first, days, today).best, computeStreakStats(first, days, today).lastDone?.ymd],
      [computeStreakStats(second, days, today).current, computeStreakStats(second, days, today).best],
    ],
    expected: [false, { title: 'Eat clean', start: '2026-03-02', end: '2026-03-04' }, [3, '2026-03-04'], [2, 2]],
  })
})
