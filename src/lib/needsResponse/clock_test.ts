import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { countedDeadline, countedMs, localDateOf, marksPassed, nextDropAt, pointsAt } from './clock.ts'

const TZ = 'America/New_York'
const HOUR = 3_600_000
/** A New York wall time in November 2026 (UTC-5), as an instant. */
const at = (day: number, time: string) =>
  Instant.from(`2026-11-${String(day).padStart(2, '0')}T${time}:00-05:00`).epochMilliseconds

test('points drop by 20 at each mark: 1 hour, 4 hours, 12 hours, 1 day, 3 days', () => {
  const since = at(10, '09:00')
  const worth = (day: number, time: string) => pointsAt(since, at(day, time), TZ)

  assert({
    given: 'a message that arrived at 9am, answered at growing delays the same week',
    should: 'earn 100 inside the first hour, then lose 20 at each mark until it is worth nothing',
    actual: {
      after30min: worth(10, '09:30'),
      at1h: worth(10, '10:00'),
      after2h: worth(10, '11:00'),
      at4h: worth(10, '13:00'),
      after5h: worth(10, '14:00'),
      at12h: worth(10, '21:00'),
      after23h: worth(11, '08:00'),
      after25h: worth(11, '10:00'),
      after3days: worth(13, '10:00'),
      after7days: worth(17, '10:00'),
    },
    expected: {
      after30min: 100,
      at1h: 100,
      after2h: 80,
      at4h: 80,
      after5h: 60,
      at12h: 60,
      after23h: 40,
      after25h: 20,
      after3days: 0,
      after7days: 0,
    },
  })
})

test('the clock stops between 10pm and 7am for the marks shorter than a day', () => {
  assert({
    given: 'a 9:30pm message answered at 7:15 the next morning',
    should: 'count only the half hour before 10pm and the quarter hour after 7am',
    actual: {
      countedHours: countedMs(at(10, '21:30'), at(11, '07:15'), TZ) / HOUR,
      points: pointsAt(at(10, '21:30'), at(11, '07:15'), TZ),
    },
    expected: { countedHours: 0.75, points: 100 },
  })

  assert({
    given: 'a 7pm message answered at 8 the next morning',
    should: 'have passed the 1-hour mark the evening before, and no other mark overnight',
    actual: pointsAt(at(10, '19:00'), at(11, '08:00'), TZ),
    expected: 80,
  })

  assert({
    given: 'a message that arrives at 2am',
    should: 'start counting at 7am',
    actual: countedMs(at(10, '02:00'), at(10, '09:00'), TZ) / HOUR,
    expected: 2,
  })
})

test('the day marks follow the calendar, nights included', () => {
  assert({
    given: 'a 10am message answered just after 10am the next day',
    should: 'have passed the 1-day mark even though fewer than 24 counted hours went by',
    actual: marksPassed(at(10, '10:00'), at(11, '10:01'), TZ),
    expected: 4,
  })
})

test('nextDropAt names the instant a waiting message loses its next 20 points', () => {
  const local = (ms: number | null) =>
    ms === null ? null : Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(TZ).toPlainDateTime().toString()

  assert({
    given: 'messages at each stage of waiting',
    should: 'drop after 1, 4 and 12 counted hours, then on the calendar at 1 and 3 days',
    actual: {
      fresh: local(nextDropAt(at(10, '13:00'), at(10, '13:30'), TZ)),
      freshOvernight: local(nextDropAt(at(10, '21:30'), at(10, '21:40'), TZ)),
      pastOneHour: local(nextDropAt(at(10, '09:00'), at(10, '11:00'), TZ)),
      pastFourHours: local(nextDropAt(at(10, '09:00'), at(10, '15:00'), TZ)),
      pastTwelveHours: local(nextDropAt(at(10, '06:00'), at(10, '21:00'), TZ)),
      pastADay: local(nextDropAt(at(10, '09:00'), at(11, '12:00'), TZ)),
      pastThreeDays: local(nextDropAt(at(10, '09:00'), at(14, '12:00'), TZ)),
    },
    expected: {
      fresh: '2026-11-10T14:00:00',
      freshOvernight: '2026-11-11T07:30:00',
      pastOneHour: '2026-11-10T13:00:00',
      pastFourHours: '2026-11-10T21:00:00',
      pastTwelveHours: '2026-11-11T06:00:00',
      pastADay: '2026-11-13T09:00:00',
      pastThreeDays: null,
    },
  })
})

test('counted time stays right across the night the clocks change', () => {
  // US clocks fall back on 2026-11-01: that night is an hour longer on the wall.
  const evening = Instant.from('2026-10-31T21:00:00-04:00').epochMilliseconds
  const morning = Instant.from('2026-11-01T08:00:00-05:00').epochMilliseconds

  assert({
    given: 'a 9pm message answered at 8am across the autumn clock change',
    should: 'still count one hour before 10pm and one after 7am',
    actual: {
      countedHours: countedMs(evening, morning, TZ) / HOUR,
      fourHourMark: Instant.fromEpochMilliseconds(countedDeadline(evening, 4, TZ))
        .toZonedDateTimeISO(TZ)
        .toPlainDateTime()
        .toString(),
      date: localDateOf(morning, TZ),
    },
    expected: { countedHours: 2, fourHourMark: '2026-11-01T10:00:00', date: '2026-11-01' },
  })
})
