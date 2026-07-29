import { assert, test } from '#test'
import { nextClockChange } from './nextClockChange.ts'

// Fixed anchor so these pin real tz-database transitions rather than moving with the clock.
const FROM = new Date('2026-07-28T12:00:00Z')

// "<instant> <signed delta>", so each case pins both when the clock moves and which way.
function changeAt(timezone: string, from: Date = FROM, horizonDays?: number): string {
  const change = nextClockChange(timezone, from, horizonDays)
  if (!change) return 'none'
  return `${change.at.toISOString()} ${change.deltaHours > 0 ? '+' : ''}${change.deltaHours}`
}

test(`nextClockChange() finds northern-hemisphere autumn transitions`, () => {
  assert({
    given: 'US Central in July',
    should: 'return 2am local on the first Sunday of November',
    expected: '2026-11-01T07:00:00.000Z -1',
    actual: changeAt('America/Chicago'),
  })
  assert({
    given: 'the UK in July',
    should: 'return 2am local on the last Sunday of October',
    expected: '2026-10-25T01:00:00.000Z -1',
    actual: changeAt('Europe/London'),
  })
})

test(`nextClockChange() finds southern-hemisphere spring transitions`, () => {
  assert({
    given: 'Sydney in July',
    should: 'return the October step forward, not a northern autumn date',
    expected: '2026-10-03T16:00:00.000Z +1',
    actual: changeAt('Australia/Sydney'),
  })
  assert({
    given: 'Lord Howe Island, whose DST shift is 30 minutes',
    should: 'still resolve the transition despite the sub-hour delta',
    expected: '2026-10-03T15:30:00.000Z +0.5',
    actual: changeAt('Australia/Lord_Howe'),
  })
})

test(`nextClockChange() covers offset changes that are not ordinary DST`, () => {
  assert({
    given: 'Casablanca, which shifts around Ramadan rather than on a DST schedule',
    should: 'report the change anyway',
    expected: '2027-02-07T02:00:00.000Z -1',
    actual: changeAt('Africa/Casablanca'),
  })
})

test(`nextClockChange() returns null for zones that hold one offset`, () => {
  assert({
    given: 'Bangkok, which has no DST',
    should: 'report no upcoming change',
    expected: 'none',
    actual: changeAt('Asia/Bangkok'),
  })
  assert({
    given: 'Kolkata, a half-hour zone with no DST',
    should: 'not mistake the fractional offset for a transition',
    expected: 'none',
    actual: changeAt('Asia/Kolkata'),
  })
  assert({
    given: 'UTC',
    should: 'report no upcoming change',
    expected: 'none',
    actual: changeAt('UTC'),
  })
})

test(`nextClockChange() respects the horizon`, () => {
  assert({
    given: 'a horizon that stops short of the next transition',
    should: 'report no upcoming change',
    expected: 'none',
    actual: changeAt('America/Chicago', FROM, 30),
  })
  assert({
    given: 'a horizon that reaches past the next transition',
    should: 'find it',
    expected: '2026-11-01T07:00:00.000Z -1',
    actual: changeAt('America/Chicago', FROM, 120),
  })
})
