import * as path from 'node:path'
import colors from 'picocolors'
import { DIR_USER_DATA } from '#config'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { streaksItemsFromDay } from '#shared/models/Streak/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { loadStreaks } from './mod.ts'

const NUDGE_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * One rate-limited afternoon reminder about unstruck streaks, printed after a
 * command finishes. The command-runner gates on TTY + time of day before
 * loading this module; this side handles the rate limit and the pending check.
 * Every failure path is silent — a nudge must never break a command.
 */
export async function maybeNudgeStreaks(): Promise<void> {
  const stampFile = path.join(DIR_USER_DATA, 'streaks-nudge.json')

  if (await exists(stampFile)) {
    try {
      const { lastNudge } = JSON.parse(await readTextFile(stampFile))
      if (Date.now() - new Date(lastNudge).getTime() < NUDGE_INTERVAL_MS) return
    } catch {
      // Unreadable stamp — treat the nudge as due
    }
  }

  const active = (await loadStreaks('active')).map((loaded) => loaded.streak)
  if (active.length === 0) return

  const today = new PlainDate()
  let day: DayDocument
  try {
    day = await readDay(today)
  } catch {
    return
  }

  const items = streaksItemsFromDay(day)
  const pending = active.filter(
    (streak) =>
      streak.isTrackedOn(today) && !items.some((item) => streak.matchesDayItem(item) && DayDocument.isItemDone(item)),
  )
  if (pending.length === 0) return

  const titles = pending.map((streak) => streak.title).join(', ')
  console.log(
    colors.dim(`\n  ◦ streaks pending today: ${titles} — strike in the day file or \`sky streaks:done <name>\``),
  )

  await outputFile(stampFile, JSON.stringify({ lastNudge: new Date().toISOString() }))
}
