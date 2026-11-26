const CLOCK_TIME = /^(\d{1,2}):(\d{2})$/
/** Same matching tolerance as day:meeting:check and schedule matching. */
const START_TOLERANCE_MINUTES = 15

function clockMinutes(time: string): number | null {
  const match = CLOCK_TIME.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const mins = Number(match[2])
  if (mins >= 60) return null
  return hours * 60 + mins
}

/** Scheduled length in whole minutes between two HH:MM clock times, crossing midnight when end < start. */
export function calendarDurationMinutes(start: string, end: string | null | undefined): number | null {
  if (!end) return null
  const from = clockMinutes(start)
  const to = clockMinutes(end)
  if (from === null || to === null) return null
  const diff = to > from ? to - from : to < from ? to + 24 * 60 - from : 0
  return diff >= 1 && diff < 24 * 60 ? diff : null
}

/**
 * Duration in minutes from an automatic calendar match when the chosen start still belongs to that match:
 * either the proposed time was left untouched (covering both "matches" and "just-after" voice memos),
 * or the person moved it to the matched event's own start time on the same day.
 */
export function matchedCalendarDuration(input: {
  calendar: { start: string; end: string | null } | null | undefined
  suggestedWhen: string
  when: string
  dayStated?: boolean
}): number | null {
  const { calendar, suggestedWhen, when, dayStated } = input
  if (!calendar || dayStated) return null
  const minutes = calendarDurationMinutes(calendar.start, calendar.end)
  if (minutes === null) return null
  const [suggestedDay] = suggestedWhen.split(' ')
  const [chosenDay, chosenTime] = when.split(' ')
  if (!chosenDay || !chosenTime || chosenDay !== suggestedDay) return null
  if (when === suggestedWhen) return minutes
  const chosenMins = clockMinutes(chosenTime)
  const calStartMins = clockMinutes(calendar.start)
  if (chosenMins !== null && calStartMins !== null && Math.abs(chosenMins - calStartMins) <= START_TOLERANCE_MINUTES) {
    return minutes
  }
  return null
}
