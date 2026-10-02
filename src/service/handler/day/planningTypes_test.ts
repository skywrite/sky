import { assert, test } from '#test'
import { entryLengthMinutes, normalizeEntryLength, splitItemTime } from './planningTypes.ts'

test('a length reads the ways a person types it', () => {
  const typed = ['45m', '45 min', '2h', '2 hours', '1h 30m', '1h30m', '1h30', '1.5h', '1:30', '(4h)', '4H']
  assert({
    given: 'minutes, hours, both together, a decimal, a clock-style length, and the parenthesized form',
    should: 'read each as whole minutes',
    actual: typed.map(entryLengthMinutes),
    expected: [45, 45, 120, 120, 90, 90, 90, 90, 90, 240, 240],
  })
  assert({
    given: 'a bare number, nothing, zero, a word, days, and a length with words after it',
    should: 'not read any of them as a length',
    actual: ['90', '', '0h', 'soon', '2 days', '1h tomorrow'].map(entryLengthMinutes),
    expected: [null, null, null, null, null, null],
  })
  assert({
    given: 'typed lengths',
    should: 'write whole hours as hours and anything else in minutes',
    actual: ['2 hours', '1h 30m', '45 min', '0.5h', 'later'].map(normalizeEntryLength),
    expected: ['2h', '90m', '45m', '30m', null],
  })
})

test('a Complete entry may say how long it took; a plan row keeps its words', () => {
  const complete = [
    '08:30 4h > Ran the bake sale',
    '08:30(4h) > Ran the bake sale',
    '08:30 (1h 30m) > Ran the bake sale',
  ]
  assert({
    given: 'a written length, the hand-typed parenthesized spellings, and a compound length',
    should: 'split the time, the minutes, and the words',
    actual: complete.map((text) => splitItemTime(text, 'Personal Complete')),
    expected: [
      { time: '08:30', minutes: 240, text: 'Ran the bake sale' },
      { time: '08:30', minutes: 240, text: 'Ran the bake sale' },
      { time: '08:30', minutes: 90, text: 'Ran the bake sale' },
    ],
  })
  assert({
    given: 'Complete entries without a length, a range, words before an arrow, and no time',
    should: 'read them as before',
    actual: ['08:30 > Lunch', '08:30 - 12:30 > Workshop', '08:30 Call Jane > notes', 'Lunch'].map((text) =>
      splitItemTime(text, 'Professional Complete'),
    ),
    expected: [
      { time: '08:30', minutes: null, text: 'Lunch' },
      { time: '08:30', minutes: null, text: '- 12:30 > Workshop' },
      { time: '08:30', minutes: null, text: 'Call Jane > notes' },
      { time: null, minutes: null, text: 'Lunch' },
    ],
  })
  assert({
    given: 'a commitment and a carried-over to-do written with a length',
    should: 'keep the length in their words',
    actual: [
      splitItemTime('09:00 1h > Standup', 'Professional Commitments'),
      splitItemTime('09:00 1h > Standup', 'Professional Incomplete'),
    ],
    expected: [
      { time: '09:00', minutes: null, text: '1h > Standup' },
      { time: '09:00', minutes: null, text: '1h > Standup' },
    ],
  })
})
