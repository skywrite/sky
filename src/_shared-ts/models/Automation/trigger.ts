import ms from 'ms'
import { matchesPattern } from '#commands/all/day/_recurring/mod.ts'
import { PlainDateTime, type ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { isValidPattern } from '#universal/dates/recurring/patterns.ts'

/*
  When an automation fires.

  Two forms, exactly one per charter:

    every: 5m                  elapsed time since the last run
    at: 07:15                  a time of day, every day
    at: EVERY-MON 09:00        a time of day on days matching a recurring pattern
    at:                        several firings share one charter
      - EVERY-MON 09:00
      - EVERY-THU 14:00

  The day half of `at:` is the recurring-pattern grammar that drives
  recurring-*.md, so anything valid there is valid here.

  ── Which clock ──

  Automations run on the machine's clock, never on notebook time. They are the
  machine's jobs, and notebook-now cannot fire before `day:start` has run, which
  is backwards for anything meant to prepare a morning.

  A bare time is therefore the local wall clock at the moment of firing, so
  travelling moves a charter with the traveller:

    at: EVERY-WEEKDAY 07:15    quarter past seven, wherever I am

  A charter that must ignore where its owner happens to be names a zone:

    at: EVERY-WEEKDAY 09:30    market open, wherever I am
    tz: America/New_York

  Naming the zone rather than a UTC offset is the point — an exchange opens at
  09:30 local, which is a different UTC hour in summer than in winter. `tz: UTC`
  is allowed and is just the degenerate case.

  Zoned charters are real wall clocks, so extended hours are rejected there:
  no zone has a 25:00.

  `every:` measures elapsed time and so has no clock to choose; it is compared
  on an absolute frame. Each charter's lastRun is recorded in that charter's own
  frame, so the two are never mixed inside one comparison.

  ── Extended hours ──

  A named day stays the anchor even past midnight, which is what keeps a late
  night attached to the day it belongs to: `EVERY-FRI 25:00` fires at one in the
  morning on Saturday, because Friday is the day that owns that hour. The parser
  keeps the hour as written; the anchor arithmetic happens here at the point of
  comparison, where the real calendar date is known.
*/

/** PlainDateTime's own documented ceiling for extended hours */
const MAX_HOUR = 99

/** `at:` with no day pattern fires every day */
const DEFAULT_PATTERN = 'EVERY-DAY'

const TIME_RE = /^(\d{1,2}):([0-5]\d)$/

export type EveryTrigger = { kind: 'every'; raw: string; intervalMs: number }
export type AtTime = { raw: string; pattern: string; hour: number; minute: number }
/** `zone` undefined means the local wall clock */
export type AtTrigger = { kind: 'at'; times: AtTime[]; zone?: string }
export type Trigger = EveryTrigger | AtTrigger

export type TriggerFields = { every?: unknown; at?: unknown; tz?: unknown }

/** A charter's trigger could not be understood; the message is user-facing */
export class TriggerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TriggerError'
  }
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function parseEvery(value: unknown): EveryTrigger {
  if (typeof value === 'number') {
    throw new TriggerError(`every: ${value} needs a unit — try ${value}m`)
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new TriggerError('every: needs a duration like 30s, 5m or 2h')
  }

  const raw = value.trim()
  if (/^\d+$/.test(raw)) {
    throw new TriggerError(`every: ${raw} needs a unit — try ${raw}m`)
  }

  let intervalMs: number | undefined
  try {
    intervalMs = ms(raw as ms.StringValue)
  } catch {
    intervalMs = undefined
  }
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TriggerError(`every: ${raw} is not a duration — try 30s, 5m or 2h`)
  }

  return { kind: 'every', raw, intervalMs }
}

function parseZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TriggerError('tz: needs a zone name like America/New_York, or UTC')
  }
  const zone = value.trim()
  try {
    // Constructing a formatter is the standard way to ask whether the runtime
    // knows a zone; it throws RangeError for anything the tz database lacks.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    throw new TriggerError(`tz: ${zone} is not a known time zone`)
  }
  return zone
}

function parseAtEntry(value: unknown, zone: string | undefined): AtTime {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TriggerError('at: needs a time like 07:15, optionally prefixed with a day pattern')
  }

  const raw = value.trim()
  const parts = raw.split(/\s+/)
  if (parts.length > 2) {
    throw new TriggerError(`at: "${raw}" should be [DAY-PATTERN ]HH:MM`)
  }

  const [pattern, time] = parts.length === 2 ? [parts[0].toUpperCase(), parts[1]] : [DEFAULT_PATTERN, parts[0]]

  if (!isValidPattern(pattern)) {
    throw new TriggerError(`at: "${raw}" has an unknown day pattern: ${pattern}`)
  }

  const match = TIME_RE.exec(time)
  if (!match) {
    throw new TriggerError(`at: "${raw}" has an unreadable time: ${time} (want HH:MM)`)
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > MAX_HOUR) {
    throw new TriggerError(`at: "${raw}" has an hour past ${MAX_HOUR}`)
  }
  if (zone && hour > 23) {
    throw new TriggerError(`at: "${raw}" is zoned to ${zone}, and no zone has an hour past 23`)
  }

  return { raw, pattern, hour, minute }
}

function parseAt(value: unknown, zone: string | undefined): AtTrigger {
  const entries = Array.isArray(value) ? value : [value]
  if (!entries.length) {
    throw new TriggerError('at: needs at least one time')
  }
  const times = entries.map((entry) => parseAtEntry(entry, zone))
  return zone ? { kind: 'at', times, zone } : { kind: 'at', times }
}

/** Read a charter's trigger fields. Throws TriggerError with a fixable message. */
export function parseTrigger(fields: TriggerFields | undefined | null): Trigger {
  // A charter with no frontmatter at all reaches here as undefined; say so
  // rather than dying on a property read.
  if (!fields || typeof fields !== 'object') {
    throw new TriggerError('Needs frontmatter with a trigger — every: <duration> or at: [DAY-PATTERN ]HH:MM')
  }

  const hasEvery = fields.every !== undefined && fields.every !== null
  const hasAt = fields.at !== undefined && fields.at !== null
  const hasTz = fields.tz !== undefined && fields.tz !== null

  if (hasEvery && hasAt) {
    throw new TriggerError('Use either every: or at:, not both')
  }
  if (!hasEvery && !hasAt) {
    throw new TriggerError('Needs a trigger — every: <duration> or at: [DAY-PATTERN ]HH:MM')
  }
  if (hasEvery && hasTz) {
    throw new TriggerError('every: measures elapsed time, so tz: has nothing to anchor — drop it, or use at:')
  }

  return hasEvery ? parseEvery(fields.every) : parseAt(fields.at, hasTz ? parseZone(fields.tz) : undefined)
}

/**
 * The clock a trigger is compared against.
 *
 * A bare `at:` charter reads the local wall clock; a zoned one reads its own
 * zone. `every:` charters measure elapsed time, so they get an absolute frame
 * (UTC) that travel and day-boundary arithmetic cannot stretch.
 *
 * Every branch normalizes, because a comparison needs the real calendar date
 * and a 0-23 clock — `inTimeZone` deliberately leaves extended hours alone.
 */
export function resolveNow(trigger: Trigger, systemNow: ZonedDateTime): PlainDateTime {
  if (trigger.kind === 'every') return systemNow.toUTC().normalize().plainDateTime
  if (!trigger.zone) return systemNow.normalize().plainDateTime
  return systemNow.inTimeZone(trigger.zone).normalize().plainDateTime
}

function isEveryDue(trigger: EveryTrigger, now: PlainDateTime, lastRun: PlainDateTime | undefined): boolean {
  if (!lastRun) return true
  // A lastRun ahead of now (rewound clock, or a notebook day that moved back)
  // yields a negative elapsed and so reads as not-due, which is the safe side.
  return lastRun.until(now).total('milliseconds') >= trigger.intervalMs
}

/** A firing that has come due, and the wall-clock minute it was owed at */
export type DueFiring = {
  /** The entry as written, e.g. "EVERY-FRI 25:00" */
  target: string
  /** Minute of the local day the firing was owed at, 0-1439 */
  fireMinutes: number
}

/**
 * Which `at:` firing is owed, if any.
 *
 * A firing past hour 24 belongs to an earlier anchor day: `EVERY-FRI 25:00` is
 * owed at 01:00 on the calendar date after a Friday. So each entry is checked
 * against the day it anchors to rather than against today.
 */
function dueAtFiring(trigger: AtTrigger, now: PlainDateTime, lastRun: PlainDateTime | undefined): DueFiring | null {
  const nowMinutes = minutesOf(now.time)
  let owed: DueFiring | null = null

  for (const time of trigger.times) {
    const daysPastAnchor = Math.floor(time.hour / 24)
    const anchor = now.plainDate.addDays(-daysPastAnchor)
    if (!matchesPattern(anchor, time.pattern)) continue

    const fireMinutes = (time.hour - daysPastAnchor * 24) * 60 + time.minute
    if (nowMinutes < fireMinutes) continue

    // YYYY-MM-DD sorts chronologically, so string comparison orders the days
    let isOwed: boolean
    if (!lastRun || lastRun.date < now.date) isOwed = true
    else if (lastRun.date > now.date)
      isOwed = false // ran later than now; leave it alone
    // Same calendar date: owed only if the last run predates this firing, which
    // is what lets a run missed while asleep catch up later the same day.
    else isOwed = minutesOf(lastRun.time) < fireMinutes

    if (!isOwed) continue

    // Several firings can be owed at once — a charter with four daily times
    // that has never run owes all the ones already past. The run answers the
    // most recent of them; the earlier ones are not backfilled. Naming the
    // earliest instead would tell a command it is fifteen hours stale when it
    // is thirteen minutes stale.
    if (!owed || fireMinutes > owed.fireMinutes) owed = { target: time.raw, fireMinutes }
  }

  return owed
}

/**
 * Which firing an automation owes right now, or null.
 *
 * `now` and `lastRun` must come from the same clock. Missed `at:` firings catch
 * up within their own calendar date and are never backfilled across days. An
 * `every:` charter has no discrete firing, so its target names the interval.
 */
export function dueFiring(
  trigger: Trigger,
  { now, lastRun }: { now: PlainDateTime; lastRun?: PlainDateTime },
): DueFiring | null {
  if (trigger.kind === 'every') {
    if (!isEveryDue(trigger, now, lastRun)) return null
    return { target: `every ${trigger.raw}`, fireMinutes: minutesOf(now.time) }
  }
  return dueAtFiring(trigger, now, lastRun)
}

/** Whether an automation should run now */
export function isDue(trigger: Trigger, clocks: { now: PlainDateTime; lastRun?: PlainDateTime }): boolean {
  return dueFiring(trigger, clocks) !== null
}

/** The trigger as written — "every 5m", or the at: entries joined */
export function describeTrigger(trigger: Trigger): string {
  if (trigger.kind === 'every') return `every ${trigger.raw}`
  return trigger.times.map((time) => time.raw).join(', ')
}

/** The clock a trigger reads: "elapsed" for every:, else the zone or "local" */
export function frameOf(trigger: Trigger): string {
  if (trigger.kind === 'every') return 'elapsed'
  return trigger.zone ?? 'local'
}
