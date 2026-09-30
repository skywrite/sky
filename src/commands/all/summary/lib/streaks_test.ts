import { assert, test } from '#test'
import { streakCompletion, streakName, streakRow } from './streaks.ts'

const DAY = [
  '---',
  'started: 07:14',
  '---',
  '',
  '# **2026-01-15 - Thu**',
  '',
  '## Professional Todos',
  '- Send Jane Doe the Atlas draft',
  '',
  '## Streaks',
  '- ~~Morning pages — 24d~~',
  '- ~~No sugar — 47d~~',
  '- ~~Lights out by ten - 2d~~',
  '- Inbox zero — 0d',
  '',
  '## Professional Complete',
  '- 09:10 > Atlas draft sent',
  '',
].join('\n')

test('streakCompletion reads the day file into done and not-done habits', () => {
  const streaks = streakCompletion(DAY)

  assert({
    given: 'a day file whose Streaks list mixes struck and open items',
    should: 'name each habit without its count, split by completion',
    actual: JSON.stringify(streaks),
    expected: JSON.stringify({
      done: ['Morning pages', 'No sugar', 'Lights out by ten'],
      notDone: ['Inbox zero'],
    }),
  })
})

test('streakName strips the marks and the count', () => {
  assert({
    given: 'a struck item with an en-dash count',
    should: 'return the habit alone',
    actual: streakName('~~Lights out by ten – 12 d~~'),
    expected: 'Lights out by ten',
  })
})

test('streakCompletion is null without a Streaks list', () => {
  const day = DAY.replace('## Streaks', '## Habits')

  assert({
    given: 'a day file with no Streaks list',
    should: 'return null so no row is written',
    actual: streakCompletion(day),
    expected: null,
  })
})

test('streakRow states completion and nothing else', () => {
  assert({
    given: 'done and not-done habits',
    should: 'write one row with no counts',
    actual: streakRow({ done: ['No sugar'], notDone: ['Inbox zero'] }),
    expected: 'done: No sugar; not done: Inbox zero',
  })
})
