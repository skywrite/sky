import { assert, test } from '#test'
import PlainDateTime from '#universal/dates/nbdt/PlainDateTime/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import { type ParsedQuery, resolveAnchor } from './resolveAnchor.ts'

const SYSTEM_TIMEZONE = 'America/Chicago'

function systemNowAt(date: string, time: string): ZonedDateTime {
  return new ZonedDateTime(new PlainDateTime({ date, time }), SYSTEM_TIMEZONE)
}

const SYSTEM_NOW = systemNowAt('2026-07-28', '08:44')

function query(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    kind: 'now',
    relativeMinutes: 0,
    hours: 0,
    minutes: 0,
    dateOffset: 0,
    sourceTimezone: '',
    ...overrides,
  }
}

function resolve(overrides: Partial<ParsedQuery>, systemNow = SYSTEM_NOW): string {
  const zdt = resolveAnchor(query(overrides), systemNow, SYSTEM_TIMEZONE)
  return `${zdt.date} ${zdt.time}`
}

test(`resolveAnchor() kind=now anchors to the current instant`, () => {
  assert({
    given: 'a "now" query',
    should: 'return the system clock untouched rather than a model-invented time',
    expected: '2026-07-28 08:44',
    actual: resolve({ kind: 'now' }),
  })
  assert({
    given: 'a "now" query',
    should: 'keep the system timezone as the source zone',
    expected: SYSTEM_TIMEZONE,
    actual: resolveAnchor(query({ kind: 'now' }), SYSTEM_NOW, SYSTEM_TIMEZONE).timezone,
  })
})

test(`resolveAnchor() kind=relative offsets from now`, () => {
  assert({
    given: '3 hours from now',
    should: 'advance the clock',
    expected: '2026-07-28 11:44',
    actual: resolve({ kind: 'relative', relativeMinutes: 180 }),
  })
  assert({
    given: '45 minutes ago',
    should: 'rewind the clock',
    expected: '2026-07-28 07:59',
    actual: resolve({ kind: 'relative', relativeMinutes: -45 }),
  })
  assert({
    given: 'an offset that crosses midnight backwards',
    should: 'roll the date back a day',
    expected: '2026-07-27 23:44',
    actual: resolve({ kind: 'relative', relativeMinutes: -540 }),
  })
  assert({
    given: 'an offset that crosses midnight forwards',
    should: 'roll the date forward a day',
    expected: '2026-07-29 01:24',
    actual: resolve({ kind: 'relative', relativeMinutes: 1000 }),
  })
})

test(`resolveAnchor() kind=wallClock uses the supplied time`, () => {
  assert({
    given: '5 PM with no date offset',
    should: "pin the time to today's date",
    expected: '2026-07-28 17:00',
    actual: resolve({ kind: 'wallClock', hours: 17, minutes: 0, sourceTimezone: 'Europe/Paris' }),
  })
  assert({
    given: 'a source timezone',
    should: 'anchor the wall clock in that zone',
    expected: 'Europe/Paris',
    actual: resolveAnchor(
      query({ kind: 'wallClock', hours: 17, sourceTimezone: 'Europe/Paris' }),
      SYSTEM_NOW,
      SYSTEM_TIMEZONE,
    ).timezone,
  })
  assert({
    given: 'no source timezone',
    should: "fall back to the user's own zone",
    expected: SYSTEM_TIMEZONE,
    actual: resolveAnchor(query({ kind: 'wallClock', hours: 17 }), SYSTEM_NOW, SYSTEM_TIMEZONE).timezone,
  })
})

// Day arithmetic runs on local date components, so these hold whatever timezone the
// process is running in. Reading the offset date back out of Date#toISOString would
// instead slip a day whenever the runtime sits east of UTC.
test(`resolveAnchor() kind=wallClock shifts the date without leaving local components`, () => {
  assert({
    given: 'tomorrow',
    should: 'advance one day',
    expected: '2026-07-29 14:00',
    actual: resolve({ kind: 'wallClock', hours: 14, dateOffset: 1 }),
  })
  assert({
    given: 'yesterday',
    should: 'rewind one day',
    expected: '2026-07-27 14:00',
    actual: resolve({ kind: 'wallClock', hours: 14, dateOffset: -1 }),
  })
  assert({
    given: 'tomorrow from the last day of a month',
    should: 'roll into the next month',
    expected: '2026-08-01 09:30',
    actual: resolve({ kind: 'wallClock', hours: 9, minutes: 30, dateOffset: 1 }, systemNowAt('2026-07-31', '08:44')),
  })
  assert({
    given: 'tomorrow from the last day of a year',
    should: 'roll into the next year',
    expected: '2027-01-01 09:30',
    actual: resolve({ kind: 'wallClock', hours: 9, minutes: 30, dateOffset: 1 }, systemNowAt('2026-12-31', '08:44')),
  })
})
