import PlainDateTime from './PlainDateTime/mod.ts'

/** Calendar boundaries use civil hours and real elapsed minutes, never notebook extended hours. */
export function calendarInterval(start: PlainDateTime, timezone: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('Duration must be a positive number of minutes.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start.time)) throw new Error('Choose a time between 00:00 and 23:59.')
  const wall = Temporal.PlainDateTime.from(`${start.date}T${start.time}`)
  // Neither a missing spring hour nor a repeated autumn hour is safe to guess for an invitation.
  const from = wall.toZonedDateTime(timezone, { disambiguation: 'reject' })
  const to = from.add({ minutes })
  const wire = (value: Temporal.ZonedDateTime) => value.toString({ timeZoneName: 'never', smallestUnit: 'second' })
  return {
    start: wire(from),
    end: wire(to),
    startMilliseconds: from.epochMilliseconds,
    endMilliseconds: to.epochMilliseconds,
    endDate: to.toPlainDate().toString(),
    endTime: to.toPlainTime().toString({ smallestUnit: 'minute' }),
  }
}

/** A provider timestamp read as an instant, preserving its explicit UTC offset. */
export function calendarInstant(value: string): number {
  return Temporal.Instant.from(value).epochMilliseconds
}

/** Render a provider instant on the civil clock in an explicit IANA zone. */
export function calendarLocal(value: string, timezone: string): PlainDateTime {
  const local = Temporal.Instant.from(value).toZonedDateTimeISO(timezone)
  return new PlainDateTime({
    date: local.toPlainDate().toString(),
    time: local.toPlainTime().toString({ smallestUnit: 'minute' }),
  })
}

/** Current civil time in an explicit zone, independent of the notebook's open day. */
export function calendarNow(timezone: string): PlainDateTime {
  const now = Temporal.Now.zonedDateTimeISO(timezone)
  return new PlainDateTime({
    date: now.toPlainDate().toString(),
    time: now.toPlainTime().toString({ smallestUnit: 'minute' }),
  })
}
