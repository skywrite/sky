import { parse as parseYaml } from '#shared/yaml/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { dueFiring, isDue, parseTrigger, resolveNow, TriggerError } from './trigger.ts'

function dt(date: string, time: string): PlainDateTime {
  return new PlainDateTime(time, date)
}

function zoned(date: string, time: string, zone: string): ZonedDateTime {
  return new ZonedDateTime(new PlainDateTime(time, date), zone)
}

function parseError(fields: { every?: unknown; at?: unknown; tz?: unknown } | undefined): string {
  try {
    parseTrigger(fields)
    return 'no error thrown'
  } catch (err) {
    return err instanceof TriggerError ? 'TriggerError' : `wrong error: ${String(err)}`
  }
}

test('parseTrigger - requires exactly one trigger form', () => {
  const fixtures = [
    { fields: {}, label: 'neither every: nor at:' },
    { fields: { every: '5m', at: '07:15' }, label: 'both every: and at:' },
    // A charter with no frontmatter arrives as undefined
    { fields: undefined, label: 'no frontmatter at all' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: fixture.label,
      should: 'be rejected',
      actual: parseError(fixture.fields),
      expected: 'TriggerError',
    })
  })
})

test('parseTrigger - every: reads ms durations', () => {
  const fixtures = [
    { every: '30s', expected: 30_000 },
    { every: '5m', expected: 300_000 },
    { every: '2h', expected: 7_200_000 },
    { every: ' 5m ', expected: 300_000 },
  ]

  fixtures.forEach((fixture) => {
    const trigger = parseTrigger({ every: fixture.every })
    assert({
      given: `every: ${fixture.every}`,
      should: 'parse to milliseconds',
      actual: trigger.kind === 'every' ? trigger.intervalMs : 'wrong kind',
      expected: fixture.expected,
    })
  })
})

test('parseTrigger - every: rejects unitless and unreadable durations', () => {
  const fixtures = [
    { every: '5', label: 'unitless string' },
    { every: 5, label: 'bare number' },
    { every: 'soon', label: 'not a duration' },
    { every: '0m', label: 'zero interval' },
    { every: '', label: 'empty' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `every: ${JSON.stringify(fixture.every)} (${fixture.label})`,
      should: 'be rejected',
      actual: parseError({ every: fixture.every }),
      expected: 'TriggerError',
    })
  })
})

test('parseTrigger - at: takes an optional day pattern before the time', () => {
  const bare = parseTrigger({ at: '07:15' })
  assert({
    given: 'at: 07:15 with no pattern',
    should: 'default to EVERY-DAY',
    actual: bare.kind === 'at' ? [bare.times[0].pattern, bare.times[0].hour, bare.times[0].minute] : 'wrong kind',
    expected: ['EVERY-DAY', 7, 15],
  })

  const patterned = parseTrigger({ at: 'every-mon 09:00' })
  assert({
    given: 'at: every-mon 09:00 in lower case',
    should: 'normalize the pattern',
    actual: patterned.kind === 'at' ? patterned.times[0].pattern : 'wrong kind',
    expected: 'EVERY-MON',
  })

  const listed = parseTrigger({ at: ['EVERY-MON 09:00', 'EVERY-THU 14:00'] })
  assert({
    given: 'a list of at: entries',
    should: 'keep every firing',
    actual: listed.kind === 'at' ? listed.times.map((t) => `${t.pattern} ${t.hour}:${t.minute}`) : 'wrong kind',
    expected: ['EVERY-MON 9:0', 'EVERY-THU 14:0'],
  })
})

test('parseTrigger - at: accepts extended hours, since a late night belongs to the day it started', () => {
  const trigger = parseTrigger({ at: 'EVERY-FRI 25:30' })

  assert({
    given: 'at: EVERY-FRI 25:30',
    should: 'keep hour 25 rather than normalizing to the next day',
    actual: trigger.kind === 'at' ? [trigger.times[0].hour, trigger.times[0].minute] : 'wrong kind',
    expected: [25, 30],
  })
})

test('parseTrigger - at: rejects bad patterns and unreadable times', () => {
  const fixtures = [
    { at: 'EVERY-MONDAY 09:00', label: 'in-family pattern typo' },
    { at: 'MONTHLY-45 09:00', label: 'pattern no date can satisfy' },
    { at: '9:5', label: 'single-digit minute' },
    { at: '09:60', label: 'minute out of range' },
    { at: '100:00', label: 'hour past the ceiling' },
    { at: 'EVERY-MON 09:00 extra', label: 'too many tokens' },
    { at: 'lunchtime', label: 'not a time' },
    { at: [], label: 'empty list' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `at: ${JSON.stringify(fixture.at)} (${fixture.label})`,
      should: 'be rejected',
      actual: parseError({ at: fixture.at }),
      expected: 'TriggerError',
    })
  })
})

test('parseTrigger - reads either YAML list style, and bare times stay strings', () => {
  // Both list styles are the same value to YAML, so both must land identically.
  // The bare-time case is the one worth pinning: under YAML 1.1 sexagesimal
  // rules 09:30 would parse as the number 570 and every such charter would
  // fail with a confusing message.
  const fixtures = [
    {
      label: 'block list',
      yaml: 'at:\n  - EVERY-MON 09:00\n  - EVERY-THU 14:00\n',
      expected: ['EVERY-MON 9:00', 'EVERY-THU 14:00'],
    },
    {
      label: 'flow list',
      yaml: 'at: [EVERY-MON 09:00, EVERY-THU 14:00]\n',
      expected: ['EVERY-MON 9:00', 'EVERY-THU 14:00'],
    },
    { label: 'single scalar', yaml: 'at: EVERY-MON 09:00\n', expected: ['EVERY-MON 9:00'] },
    { label: 'bare time', yaml: 'at: 09:30\n', expected: ['EVERY-DAY 9:30'] },
  ]

  fixtures.forEach((fixture) => {
    const trigger = parseTrigger(parseYaml(fixture.yaml) as Record<string, unknown>)
    assert({
      given: `${fixture.label} frontmatter`,
      should: 'parse to the same firings',
      actual:
        trigger.kind === 'at'
          ? trigger.times.map((t) => `${t.pattern} ${t.hour}:${String(t.minute).padStart(2, '0')}`)
          : 'wrong kind',
      expected: fixture.expected,
    })
  })
})

test('parseTrigger - tz: names a zone for at: charters', () => {
  const trigger = parseTrigger({ at: 'EVERY-WEEKDAY 09:30', tz: 'America/New_York' })

  assert({
    given: 'at: EVERY-WEEKDAY 09:30 with tz: America/New_York',
    should: 'carry the zone alongside the time',
    actual: trigger.kind === 'at' ? [trigger.zone, trigger.times[0].hour, trigger.times[0].minute] : 'wrong kind',
    expected: ['America/New_York', 9, 30],
  })

  assert({
    given: 'at: 07:15 with no tz:',
    should: 'leave the zone unset, meaning notebook time',
    actual: (() => {
      const notebook = parseTrigger({ at: '07:15' })
      return notebook.kind === 'at' ? notebook.zone : 'wrong kind'
    })(),
    expected: undefined,
  })
})

test('parseTrigger - tz: rejects what it cannot anchor', () => {
  const fixtures = [
    { fields: { every: '5m', tz: 'UTC' }, label: 'tz: on an elapsed-time trigger' },
    { fields: { at: '09:00', tz: 'Mars/Olympus' }, label: 'unknown zone' },
    { fields: { at: '09:00', tz: '' }, label: 'empty zone' },
    { fields: { at: 'EVERY-FRI 25:00', tz: 'UTC' }, label: 'extended hour in a real zone' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: fixture.label,
      should: 'be rejected',
      actual: parseError(fixture.fields),
      expected: 'TriggerError',
    })
  })
})

test('resolveNow - picks the clock the charter asked for', () => {
  const systemNow = zoned('2026-08-22', '01:30', 'America/Chicago')

  const localTrigger = parseTrigger({ at: '07:15' })
  assert({
    given: 'a bare at: charter',
    should: 'read the local wall clock',
    actual: (() => {
      const now = resolveNow(localTrigger, systemNow)
      return `${now.date} ${now.time}`
    })(),
    expected: '2026-08-22 01:30',
  })

  const zonedTrigger = parseTrigger({ at: '09:30', tz: 'America/New_York' })
  assert({
    given: 'a zoned at: charter, when Chicago says 01:30 on the 22nd',
    should: 'read that zone real wall clock',
    actual: (() => {
      const now = resolveNow(zonedTrigger, systemNow)
      return `${now.date} ${now.time}`
    })(),
    expected: '2026-08-22 02:30',
  })

  const everyTrigger = parseTrigger({ every: '5m' })
  assert({
    given: 'an every: charter',
    should: 'read an absolute UTC frame',
    actual: (() => {
      const now = resolveNow(everyTrigger, systemNow)
      return `${now.date} ${now.time}`
    })(),
    expected: '2026-08-22 06:30',
  })
})

test('resolveNow - a zoned charter keeps its own calendar day across the date line', () => {
  // 01:00 UTC on the 22nd is still the evening of the 21st in New York
  const systemNow = zoned('2026-08-22', '01:00', 'UTC')
  const trigger = parseTrigger({ at: '21:00', tz: 'America/New_York' })
  const now = resolveNow(trigger, systemNow)

  assert({
    given: '01:00 UTC on 2026-08-22',
    should: 'resolve to the previous day in New York',
    actual: `${now.date} ${now.time}`,
    expected: '2026-08-21 21:00',
  })
})

test('isDue - a zoned charter fires on its zone clock, not the traveler location', () => {
  // Market open: 09:30 in New York every weekday, wherever the laptop is
  const trigger = parseTrigger({ at: 'EVERY-WEEKDAY 09:30', tz: 'America/New_York' })

  const fixtures = [
    { systemNow: zoned('2026-08-21', '13:30', 'UTC'), expected: true, label: '13:30 UTC — 09:30 in New York' },
    { systemNow: zoned('2026-08-21', '13:00', 'UTC'), expected: false, label: '13:00 UTC — 09:00, before the open' },
    { systemNow: zoned('2026-08-22', '14:00', 'UTC'), expected: false, label: 'Saturday, not a weekday' },
  ]

  fixtures.forEach((fixture) => {
    const now = resolveNow(trigger, fixture.systemNow)
    assert({
      given: `market-open charter at ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now, lastRun: undefined }),
      expected: fixture.expected,
    })
  })
})

test('isDue - every: waits for the interval to elapse', () => {
  const trigger = parseTrigger({ every: '5m' })
  const now = dt('2026-08-21', '10:00')

  const fixtures = [
    { lastRun: undefined, expected: true, label: 'never run' },
    { lastRun: dt('2026-08-21', '09:55'), expected: true, label: 'exactly one interval ago' },
    { lastRun: dt('2026-08-21', '09:56'), expected: false, label: 'four minutes ago' },
    { lastRun: dt('2026-08-21', '09:00'), expected: true, label: 'an hour ago' },
    { lastRun: dt('2026-08-21', '10:30'), expected: false, label: 'ahead of now' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `every: 5m, last run ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now, lastRun: fixture.lastRun }),
      expected: fixture.expected,
    })
  })
})

test('isDue - at: fires once per notebook day, after the time', () => {
  const trigger = parseTrigger({ at: '07:15' })

  const fixtures = [
    { now: dt('2026-08-21', '07:00'), lastRun: undefined, expected: false, label: 'before the time' },
    { now: dt('2026-08-21', '07:15'), lastRun: undefined, expected: true, label: 'exactly at the time' },
    { now: dt('2026-08-21', '09:00'), lastRun: undefined, expected: true, label: 'after the time, never run' },
    {
      now: dt('2026-08-21', '09:00'),
      lastRun: dt('2026-08-21', '07:15'),
      expected: false,
      label: 'already ran today',
    },
    {
      now: dt('2026-08-21', '09:00'),
      lastRun: dt('2026-08-20', '07:15'),
      expected: true,
      label: 'last ran yesterday',
    },
    {
      now: dt('2026-08-21', '09:00'),
      lastRun: dt('2026-08-21', '06:00'),
      expected: true,
      label: 'ran earlier today but before the firing time',
    },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `at: 07:15 — ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now: fixture.now, lastRun: fixture.lastRun }),
      expected: fixture.expected,
    })
  })
})

test('isDue - at: catches up within the notebook day but never backfills across days', () => {
  const trigger = parseTrigger({ at: 'EVERY-FRI 09:00' })

  const fixtures = [
    // 2026-08-21 is a Friday: asleep at 09:00, awake at 14:00 — still fires
    { now: dt('2026-08-21', '14:00'), lastRun: dt('2026-08-14', '09:00'), expected: true, label: 'missed, same day' },
    // Saturday: Friday's firing is gone, not owed
    {
      now: dt('2026-08-22', '10:00'),
      lastRun: dt('2026-08-14', '09:00'),
      expected: false,
      label: 'day after a missed Friday',
    },
    // Thursday never matches the pattern
    { now: dt('2026-08-20', '10:00'), lastRun: undefined, expected: false, label: 'pattern does not match the day' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `at: EVERY-FRI 09:00 — ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now: fixture.now, lastRun: fixture.lastRun }),
      expected: fixture.expected,
    })
  })
})

test('isDue - an extended hour keeps the named day as its anchor', () => {
  // EVERY-FRI 25:00 is owed at 01:00 on the calendar date after a Friday,
  // because Friday is the day that owns that hour.
  const trigger = parseTrigger({ at: 'EVERY-FRI 25:00' })

  const fixtures = [
    { now: dt('2026-08-22', '01:30'), expected: true, label: 'Saturday 01:30, the hour Friday owns' },
    { now: dt('2026-08-22', '00:30'), expected: false, label: 'Saturday 00:30, before the firing' },
    { now: dt('2026-08-21', '23:00'), expected: false, label: 'Friday 23:00 — Thursday is the anchor there' },
    { now: dt('2026-08-23', '01:30'), expected: false, label: 'Sunday 01:30 — Saturday is not a Friday' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `at: EVERY-FRI 25:00 — ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now: fixture.now, lastRun: undefined }),
      expected: fixture.expected,
    })
  })
})

test('dueFiring - when several firings are owed, the run answers the most recent', () => {
  // Caught live: a four-times-daily charter created at 21:13 having never run
  // owes 06:00, 11:00, 16:00 and 21:00. Answering the earliest reported the run
  // as 913 minutes late when it was thirteen.
  const trigger = parseTrigger({ at: ['06:00', '11:00', '16:00', '21:00'] })

  assert({
    given: 'four daily firings, never run, asked at 21:13',
    should: 'answer the 21:00 firing, thirteen minutes late',
    actual: dueFiring(trigger, { now: dt('2026-08-26', '21:13'), lastRun: undefined }),
    expected: { target: '21:00', fireMinutes: 1260 },
  })

  assert({
    given: 'the same charter asked at 12:00',
    should: 'answer 11:00 rather than 06:00',
    actual: dueFiring(trigger, { now: dt('2026-08-26', '12:00'), lastRun: undefined })?.target,
    expected: '11:00',
  })

  assert({
    given: 'firings declared out of order',
    should: 'still answer the most recent one owed',
    actual: dueFiring(parseTrigger({ at: ['21:00', '06:00', '16:00'] }), {
      now: dt('2026-08-26', '17:00'),
      lastRun: undefined,
    })?.target,
    expected: '16:00',
  })

  assert({
    given: 'one run already recorded after the 11:00 firing',
    should: 'answer only the firings that postdate it',
    actual: dueFiring(trigger, { now: dt('2026-08-26', '21:13'), lastRun: dt('2026-08-26', '11:05') })?.target,
    expected: '21:00',
  })
})

test('dueFiring - names which firing is owed and the minute it was owed at', () => {
  const trigger = parseTrigger({ at: ['09:00', '16:00'] })

  assert({
    given: 'two firings, asked at 16:05 having run at 09:00',
    should: 'name the 16:00 firing and its minute of the day',
    actual: dueFiring(trigger, { now: dt('2026-08-24', '16:05'), lastRun: dt('2026-08-24', '09:00') }),
    expected: { target: '16:00', fireMinutes: 960 },
  })

  assert({
    given: 'nothing owed',
    should: 'be null',
    actual: dueFiring(trigger, { now: dt('2026-08-24', '08:00'), lastRun: undefined }),
    expected: null,
  })

  const every = parseTrigger({ every: '5m' })
  assert({
    given: 'an elapsed-time charter that is due',
    should: 'name the interval rather than a firing',
    actual: dueFiring(every, { now: dt('2026-08-24', '13:35'), lastRun: undefined })?.target,
    expected: 'every 5m',
  })
})

test('isDue - at: a list fires on whichever entry matches', () => {
  const trigger = parseTrigger({ at: ['EVERY-MON 09:00', 'EVERY-THU 14:00'] })

  const fixtures = [
    { now: dt('2026-08-24', '09:30'), expected: true, label: 'Monday after 09:00' },
    { now: dt('2026-08-24', '08:00'), expected: false, label: 'Monday before 09:00' },
    { now: dt('2026-08-27', '14:00'), expected: true, label: 'Thursday at 14:00' },
    { now: dt('2026-08-27', '10:00'), expected: false, label: 'Thursday before 14:00' },
    { now: dt('2026-08-26', '15:00'), expected: false, label: 'Wednesday matches neither' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `two at: entries — ${fixture.label}`,
      should: fixture.expected ? 'be due' : 'not be due',
      actual: isDue(trigger, { now: fixture.now, lastRun: undefined }),
      expected: fixture.expected,
    })
  })
})
