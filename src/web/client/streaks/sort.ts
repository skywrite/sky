import type { StreakView } from '../../../service/handler/streaks/types.ts'

/** Sort streaks with items completed on `date` first, then by longest current run. */
export function sortStreaks(streaks: readonly StreakView[], date: string): StreakView[] {
  const done = new Set(streaks.filter((streak) => streak.done.includes(date)))
  return streaks.toSorted((a, b) => {
    const doneDiff = Number(done.has(b)) - Number(done.has(a))
    if (doneDiff !== 0) return doneDiff
    return b.current - a.current
  })
}
