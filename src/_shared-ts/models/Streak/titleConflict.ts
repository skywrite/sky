import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

/**
 * The part of a streak that decides which day items it reads: its title (the
 * day-file join key) and the days it is tracked. Dates are YYYY-MM-DD.
 */
export interface StreakSpan {
  title: string
  /** First tracked day. Without a readable start, dates cannot tell two streaks apart. */
  start?: string | null
  /** Last tracked day, inclusive. Absent means the streak has no end yet. */
  end?: string | null
}

/** Why a title cannot be used for the requested days, and when it becomes free. */
export interface StreakTitleConflict {
  /** The existing streak's title, in its own capitalization. */
  title: string
  /** Its last tracked day. Set only when every streak in the way has an end. */
  through?: string
  /** The first day another streak with this title could start. */
  freeFrom?: string
}

// A hand-edited rule can carry a non-text title (`title: 2048`); compare it as written.
const titleKey = (title: unknown): string =>
  String(title ?? '')
    .trim()
    .toLowerCase()

/**
 * Whether two streaks would read the same day item: the same title on at
 * least one day both are tracked.
 *
 * A title may be reused once the earlier streak has ended. Every reader
 * counts a streak only between its own start and end, so two streaks whose
 * dates never meet keep separate histories even though the day files spell
 * both the same way.
 */
export function streaksShareDays(a: StreakSpan, b: StreakSpan): boolean {
  if (titleKey(a.title) !== titleKey(b.title)) return false
  if (!a.start || !b.start) return true
  return (!b.end || a.start <= b.end) && (!a.end || b.start <= a.end)
}

/** The existing streaks that stand in the way of `candidate`, summarized for one message. */
export function findStreakTitleConflict(
  candidate: StreakSpan,
  existing: readonly StreakSpan[],
): StreakTitleConflict | undefined {
  const sharing = existing.filter((streak) => streaksShareDays(candidate, streak))
  if (!sharing.length) return undefined
  if (sharing.some((streak) => !streak.start || !streak.end)) return { title: sharing[0].title }
  const last = sharing.reduce((latest, streak) => (streak.end! > latest.end! ? streak : latest))
  return { title: last.title, through: last.end!, freeFrom: new PlainDate(last.end!).addDays(1).ymd }
}

/**
 * The refusal in plain words, with the way out when there is one.
 * `noun` is what the surface calls a title: the app says "name", the CLI "title".
 */
export function streakTitleConflictMessage(
  conflict: StreakTitleConflict,
  today: string,
  noun: 'name' | 'title' = 'name',
): string {
  if (!conflict.through || !conflict.freeFrom) return `A streak already uses this ${noun}. Choose a different ${noun}.`
  const verb = conflict.through < today ? 'ran' : 'runs'
  return `“${conflict.title}” ${verb} through ${conflict.through}. Start on ${conflict.freeFrom} or later, or choose a different ${noun}.`
}
