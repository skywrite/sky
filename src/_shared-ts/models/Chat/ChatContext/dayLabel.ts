import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Build the date prefix stamped onto each context file's path comment.
 *
 * Context renders in type order, so a block of meetings spanning eight days
 * arrives with no chronological structure. The only date cue is the day dir
 * buried in the path (`time/2026/05/11-17/05-14/`, where the week-range
 * segment invites a misread) plus a `created:` field that journals omit
 * entirely and entity docs use for file edits rather than events. That left
 * the model inferring a document's day from its neighbours, which misdates
 * today's lone document when it sits in a run of yesterday's.
 *
 * Undated documents (people, orgs, goals) get no label - their paths have no
 * day dir to parse, and dating them from `created:` would be a lie.
 */
export default function createDayLabeler(today: PlainDate): (path: string) => string | undefined {
  const todayMs = today.toDate().getTime()

  return (filePath: string) => {
    let date: PlainDate
    try {
      date = parseDateFromDayPath(filePath)
    } catch {
      return undefined
    }

    // Round rather than floor: both sides are local midnight, so a DST shift
    // otherwise stretches a whole-day gap to 25 hours and skews the count.
    const daysSince = Math.round((todayMs - date.toDate().getTime()) / MS_PER_DAY)
    const stamp = `${date.ymd} ${date.dayShort}`

    // TODAY is shouted because it is the anchor the model most often loses.
    if (daysSince === 0) return `${stamp} (TODAY)`
    if (daysSince === 1) return `${stamp} (yesterday)`
    if (daysSince > 1 && daysSince < 7) return `${stamp} (${daysSince} days ago)`
    if (daysSince < 0) return `${stamp} (future)`
    return stamp
  }
}
