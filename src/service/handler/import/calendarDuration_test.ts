import { assert, test } from '#test'
import { calendarDurationMinutes, matchedCalendarDuration } from './calendarDuration.ts'

test('calendarDurationMinutes() computes lengths across normal, overnight, and invalid inputs', () => {
  assert({
    given: 'normal, overnight, extended-hour, equal, missing, and malformed clock bounds',
    should: 'return whole positive minutes or null when no valid span exists',
    actual: [
      calendarDurationMinutes('09:30', '10:00'),
      calendarDurationMinutes('08:15', '09:45'),
      calendarDurationMinutes('23:30', '00:30'),
      calendarDurationMinutes('23:30', '24:30'),
      calendarDurationMinutes('10:00', '10:00'),
      calendarDurationMinutes('10:00', null),
      calendarDurationMinutes('', '10:30'),
      calendarDurationMinutes('10:99', '11:00'),
    ],
    expected: [30, 90, 60, 60, null, null, null, null],
  })
})

test('matchedCalendarDuration() applies only while the chosen start still belongs to the match', () => {
  const calendar = { start: '08:15', end: '08:45' }
  const suggestedWhen = '2026-01-27 08:47'
  assert({
    given: 'a voice memo matched just after an 08:15–08:45 calendar event',
    should: 'carry 30m when left as proposed or moved to the meeting start, and drop it otherwise',
    actual: [
      matchedCalendarDuration({ calendar, suggestedWhen, when: suggestedWhen }),
      matchedCalendarDuration({ calendar, suggestedWhen, when: '2026-01-27 08:15' }),
      matchedCalendarDuration({ calendar, suggestedWhen, when: '2026-01-27 08:25' }),
      matchedCalendarDuration({ calendar, suggestedWhen, when: '2026-01-27 14:00' }),
      matchedCalendarDuration({ calendar, suggestedWhen, when: '2026-01-26 08:15' }),
      matchedCalendarDuration({ calendar, suggestedWhen, when: suggestedWhen, dayStated: true }),
      matchedCalendarDuration({ calendar: { start: '08:15', end: null }, suggestedWhen, when: suggestedWhen }),
    ],
    expected: [30, 30, 30, null, null, null, null],
  })
})
