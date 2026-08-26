import { assert, test } from '#test'
import { extractTypedTime, labelledTimeRaw } from './extractTypedTime.ts'

const value = (correction: string, referenceDate?: string) => extractTypedTime(correction, referenceDate)?.value ?? null

test('extractTypedTime reads the labelled forms the prompts advertise', () => {
  assert({
    given: 'the time: label with a date, as audio:transcript:summary prompts for',
    should: 'return date and time',
    actual: value('time: 2026-01-20 14:30'),
    expected: '2026-01-20 14:30',
  })
  assert({
    given: 'the when: label with a bare time, as message:new prompts for',
    should: 'return just the time',
    actual: value('when: 14:30'),
    expected: '14:30',
  })
  assert({
    given: 'a label among other corrections',
    should: 'pick out the time field',
    actual: value('medium: Signal, from: Alice, when: 14:30'),
    expected: '14:30',
  })
  assert({
    given: 'a capitalised label',
    should: 'match case-insensitively',
    actual: value('Time: 2026-01-20 14:30'),
    expected: '2026-01-20 14:30',
  })
})

test('extractTypedTime preserves extended notebook hours', () => {
  assert({
    given: 'an extended hour, which the model used to reject as invalid',
    should: 'pass it through untouched',
    actual: value('time: 2026-03-31 25:30'),
    expected: '2026-03-31 25:30',
  })
  assert({
    given: 'a day left open across two nights',
    should: 'keep the hour past 25 as well',
    actual: value('when: 49:30'),
    expected: '49:30',
  })
  assert({
    given: 'a negative hour, valid per docs/nbfs.md',
    should: 'keep the documented unpadded form',
    actual: value('when: -7:56'),
    expected: '-7:56',
  })
})

test('extractTypedTime normalizes only the notation', () => {
  assert({
    given: 'a single-digit clock hour',
    should: 'zero-pad it',
    actual: value('time: 2026-01-27 8:44'),
    expected: '2026-01-27 08:44',
  })
  assert({
    given: 'a pm meridiem',
    should: 'convert to 24-hour notation',
    actual: value('when: 8:44pm'),
    expected: '20:44',
  })
  assert({
    given: 'noon and midnight, the meridiem edge cases',
    should: 'map 12pm to 12 and 12am to 00',
    actual: [value('when: 12:00pm'), value('when: 12:00am')],
    expected: ['12:00', '00:00'],
  })
})

test('extractTypedTime declines what it should not guess at', () => {
  assert({
    given: 'a bare time with no label',
    should: 'return null rather than guessing',
    actual: value('14:30'),
    expected: null,
  })
  assert({
    given: 'a time mentioned inside another field',
    should: 'not mistake it for the time field',
    actual: value('summary: the 3:30 standup ran long'),
    expected: null,
  })
  assert({
    given: 'relative phrasing the AI still has to interpret',
    should: 'return null so the caller falls back',
    actual: value('when: an hour later than that'),
    expected: null,
  })
  assert({
    given: 'an out-of-range minute',
    should: 'decline it',
    actual: value('when: 14:75'),
    expected: null,
  })
  assert({
    given: 'a malformed date',
    should: 'decline rather than pass a bad date through',
    actual: value('time: 2026-13-45 14:30'),
    expected: null,
  })
  assert({
    given: 'an extended hour carrying a meridiem, which is contradictory',
    should: 'decline it',
    actual: value('when: 25:30pm'),
    expected: null,
  })
  assert({
    given: 'a correction with no time at all',
    should: 'return null',
    actual: value('medium: Zoom, rel: Alice'),
    expected: null,
  })
})

test('extractTypedTime resolves partial dates against the reference date', () => {
  assert({
    given: 'a month-day already past in the reference year',
    should: 'use the reference year',
    actual: value('time: 03-14 13:00', '2026-07-15'),
    expected: '2026-03-14 13:00',
  })
  assert({
    given: 'a month-day still ahead in the reference year',
    should: 'use the previous year — corrections describe the past',
    actual: value('time: 11-05 13:00', '2026-07-15'),
    expected: '2025-11-05 13:00',
  })
  assert({
    given: 'the reference day itself, in single-digit notation',
    should: 'stay in the reference year and zero-pad',
    actual: value('when: 7-15 9:05', '2026-07-15'),
    expected: '2026-07-15 09:05',
  })
  assert({
    given: 'Feb 29 with a non-leap reference year',
    should: 'walk back to the latest leap year',
    actual: value('time: 02-29 10:00', '2026-07-15'),
    expected: '2024-02-29 10:00',
  })
  assert({
    given: 'a partial date but no reference date to resolve against',
    should: 'decline rather than guess a year',
    actual: value('time: 03-14 13:00'),
    expected: null,
  })
  assert({
    given: 'a day no month has',
    should: 'decline it',
    actual: value('time: 06-31 13:00', '2026-07-15'),
    expected: null,
  })
  assert({
    given: 'an out-of-range month',
    should: 'decline it',
    actual: value('time: 13-05 13:00', '2026-07-15'),
    expected: null,
  })
})

test('extractTypedTime reports whether the year was inferred', () => {
  const partial = extractTypedTime('time: 03-14 13:00', '2026-07-15')
  const full = extractTypedTime('time: 2026-03-14 13:00', '2026-07-15')
  assert({
    given: 'a partial date and a full date',
    should: 'flag only the inferred year',
    actual: [partial?.yearInferred, full?.yearInferred],
    expected: [true, false],
  })
})

test('labelledTimeRaw surfaces a typed time extractTypedTime declines', () => {
  assert({
    given: 'relative phrasing under the time label',
    should: 'return the raw text so the caller can warn about the AI fallback',
    actual: labelledTimeRaw('when: an hour later than that'),
    expected: 'an hour later than that',
  })
  assert({
    given: 'a correction with no labelled time',
    should: 'return null',
    actual: labelledTimeRaw('summary: the 3:30 standup ran long'),
    expected: null,
  })
})

test('extractTypedTime reports what it matched', () => {
  const typed = extractTypedTime('medium: Zoom, time: 2026-03-31 25:30')
  assert({
    given: 'a labelled time among other fields',
    should: 'carry the raw text and date flag for reporting',
    actual: { raw: typed?.raw, hasDate: typed?.hasDate },
    expected: { raw: '2026-03-31 25:30', hasDate: true },
  })
})
