/**
 * When a transcript that stamps the clock began: its first cue's time of
 * day on the day the file was saved — or the day before, when the clock
 * runs later than the save, since a transcript is saved after it began.
 */

import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export function startOnSavedDay(savedMs: number, clockSeconds: number): ZonedDateTime {
  const saved = new ZonedDateTime(new Date(savedMs))
  const clock = `${pad(Math.floor(clockSeconds / 3600))}:${pad(Math.floor((clockSeconds % 3600) / 60))}`
  const day = saved.plainDateTime.plainDate
  const sameDay = new ZonedDateTime(new PlainDateTime(clock, day))
  if (sameDay.epochMilliseconds <= savedMs) return sameDay
  return new ZonedDateTime(new PlainDateTime(clock, day.addDays(-1)))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
