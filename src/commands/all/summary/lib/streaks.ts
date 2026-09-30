import DayDocument from '#shared/models/Day/document/mod.ts'

/**
 * The day's streaks, as the summary is allowed to know them: which habits
 * were done that day and which were not. Never the running count.
 *
 * The day file's Streaks list carries a count in each item ("No sugar — 47d")
 * that depends on every previous day. A summary is written once and days are
 * sometimes ended out of order, so any count written into the file is wrong
 * or unstable. The summary records the day's own fact only.
 */
export interface StreakCompletion {
  done: string[]
  notDone: string[]
}

const STREAKS_HEADING = /^streaks$/i

// "No sugar — 47d", "No sugar - 0d", "No sugar – 12 d": the count suffix
// the streak commands write after a dash of any kind.
const COUNT_SUFFIX = /\s+[—–-]\s+\d+\s*d\s*$/

/** The habit's name alone: strike marks and the day count removed. */
export function streakName(raw: string): string {
  return raw
    .trim()
    .replace(/^~~|~~$/g, '')
    .trim()
    .replace(COUNT_SUFFIX, '')
    .trim()
}

/**
 * Read the Streaks list out of a day file. Null when the day has no Streaks
 * list or the list is empty, so the caller writes nothing rather than an
 * empty row.
 */
export function streakCompletion(dayMarkdown: string): StreakCompletion | null {
  let lists: DayDocument['lists']
  try {
    lists = DayDocument.fromMarkdown(dayMarkdown).lists
  } catch {
    return null
  }
  const list = lists.find((l) => STREAKS_HEADING.test(l.title.trim()))
  if (!list) return null

  const done: string[] = []
  const notDone: string[] = []
  for (const raw of list.items) {
    const name = streakName(raw)
    if (!name) continue
    ;(DayDocument.isItemDone(raw.trim()) ? done : notDone).push(name)
  }
  if (done.length === 0 && notDone.length === 0) return null
  return { done, notDone }
}

/**
 * The one Health row the model copies verbatim — completion only, in the
 * day's own words, no counts anywhere.
 */
export function streakRow(streaks: StreakCompletion): string {
  const parts: string[] = []
  if (streaks.done.length > 0) parts.push(`done: ${streaks.done.join(', ')}`)
  if (streaks.notDone.length > 0) parts.push(`not done: ${streaks.notDone.join(', ')}`)
  return parts.join('; ')
}
