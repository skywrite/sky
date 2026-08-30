import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type CheckClock, renderDayCalendar } from '../../day/meeting/lib/meetingCheck.ts'
import { gatherHealthData, type HealthData } from '../../summary/_health.ts'
import { type DayPriceData, gatherDayPriceData } from '../../summary/_prices.ts'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AIContext {
  today: { date: string; dayOfWeek: string }
  health: Array<{ date: string; data: HealthData }>
  prices: Array<{ date: string; data: DayPriceData }>
  /** The day's calendar checked against the notebook's meeting records, rendered for the model */
  calendar: string
}

/** What the calendar check needs beyond the day: the keychain, and the notebook clock it judges "upcoming" by. */
export interface CalendarCheck {
  secrets: SecretsProvider
  now: CheckClock
}

// -----------------------------------------------------------------------------
// Main Function
// -----------------------------------------------------------------------------

/**
 * Gather context from the Notebook for AI chat.
 * Collects health and prices for the specified number of days, and the
 * day's calendar checked against the notebook (day:meeting:check's check).
 * Summaries, goals, and activity are handled via DomainCollection.
 */
export async function gatherContext(
  today: PlainDate,
  _timeDir: string,
  dataDir: string,
  days: number,
  calendar: CalendarCheck,
): Promise<AIContext> {
  // A Google round-trip: it runs beside the day-by-day reads.
  const calendarBlock = renderDayCalendar(calendar.secrets, today, _timeDir, calendar.now)

  // Day-by-day data
  const health: AIContext['health'] = []
  const prices: AIContext['prices'] = []

  // Iterate through last N days (most recent last for chronological order)
  for (let i = days - 1; i >= 0; i--) {
    const day = today.addDays(-i)
    const dateStr = day.ymd

    // Gather data for this day in parallel
    const [healthData, priceData] = await Promise.all([
      gatherHealthData(day, _timeDir),
      gatherDayPriceData(day, dataDir),
    ])

    // Only include health data if there's something to report
    if (healthData.sleep || healthData.weight || healthData.strength || healthData.work) {
      health.push({ date: dateStr, data: healthData })
    }

    // Only include price data if there are prices
    if (priceData.prices.length > 0) {
      prices.push({ date: dateStr, data: priceData })
    }
  }

  return {
    today: {
      date: today.ymd,
      dayOfWeek: today.dayLong,
    },
    health,
    prices,
    calendar: await calendarBlock,
  }
}
