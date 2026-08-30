import { assert, test } from '#test'
import { buildContextPrompt } from './contextPrompt.ts'

const AMBIENT = { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] }

test(buildContextPrompt.name, () => {
  const prompt = buildContextPrompt(AMBIENT, '<!-- 2026-01-27 Tue (TODAY) | time/x.md -->\nbody')
  const lines = prompt.split('\n')

  assert({
    given: 'an ambient day and activity markdown',
    should: 'open with the day header',
    actual: lines[0],
    expected: '# Context for 2026-01-27 (Tuesday)',
  })
  assert({
    given: 'the same segment',
    should: 'close with the day anchor, naming today and yesterday with their weekdays',
    actual: lines.slice(-3),
    expected: [
      '## Today',
      '',
      'Tuesday 2026-01-27 is today, the notebook date. Documents labeled (TODAY) are from today; (yesterday) is Monday 2026-01-26. The newest `[Time: ...]` message stamp is the exact current time.',
    ],
  })
  assert({
    given: 'the same segment',
    should: 'keep the activity markdown ahead of the anchor',
    actual: prompt.indexOf('body') < prompt.indexOf('## Today'),
    expected: true,
  })
  assert({
    given: 'no calendar from the host',
    should: 'say the calendar went unchecked, ahead of the prices',
    actual: lines.slice(2, 8),
    expected: ['## Calendar', '', '(Calendar not checked)', '', '## Prices', ''],
  })
  assert({
    given: 'a rendered calendar check',
    should: 'place it under the calendar heading as given',
    actual: buildContextPrompt({ ...AMBIENT, calendar: 'No meetings on the calendar for 2026-01-27.' }, null)
      .split('\n')
      .slice(2, 5),
    expected: ['## Calendar', '', 'No meetings on the calendar for 2026-01-27.'],
  })
  assert({
    given: 'a malformed ambient date',
    should: 'still close with the anchor, without a second date',
    actual: buildContextPrompt({ ...AMBIENT, today: { date: 'today', dayOfWeek: '?' } }, null).includes(
      '(yesterday) is the day before.',
    ),
    expected: true,
  })
})
