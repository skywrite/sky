import { assert, test } from '#test'
import { extractTypedTime } from './extractTypedTime.ts'

const value = (correction: string) => extractTypedTime(correction)?.value ?? null

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

test('extractTypedTime reports what it matched', () => {
  const typed = extractTypedTime('medium: Zoom, time: 2026-03-31 25:30')
  assert({
    given: 'a labelled time among other fields',
    should: 'carry the raw text and date flag for reporting',
    actual: { raw: typed?.raw, hasDate: typed?.hasDate },
    expected: { raw: '2026-03-31 25:30', hasDate: true },
  })
})
