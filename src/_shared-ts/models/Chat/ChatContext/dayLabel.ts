import { parseTimePath } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Build the date prefix stamped onto each context file's path comment.
 *
 * Context renders in type order, so a block of meetings spanning eight days
 * arrives with no chronological structure. The only date cue is the day dir
 * buried in the path (`time/2026/W20/05-14/`; in the older `YYYY/MM/DD-DD`
 * layout the week-range segment even invited a misread) plus a `created:` field that journals omit
 * entirely and entity docs use for file edits rather than events. That left
 * the model inferring a document's day from its neighbours, which misdates
 * today's lone document when it sits in a run of yesterday's.
 *
 * Week-level docs (the week plan) are stamped with their span, and the
 * current week is called out the way today is: it is the frame the model
 * should read the week's questions through.
 *
 * Undated documents (people, orgs, goals) get no label - their paths have no
 * day dir to parse, and dating them from `created:` would be a lie.
 */
export default function createDayLabeler(today: PlainDate): (path: string) => string | undefined {
  const todayMs = today.toDate().getTime()

  return (filePath: string) => {
    const info = parseTimePath(filePath)
    if (!info) return undefined

    if (info.kind === 'week') {
      const stamp = `week ${info.start.ymd} - ${info.end.ymd}`
      if (PlainDate.compare(today, info.start) < 0) return `${stamp} (future)`
      if (PlainDate.compare(today, info.end) <= 0) return `${stamp} (THIS WEEK)`
      const daysPast = Math.round((todayMs - info.end.toDate().getTime()) / MS_PER_DAY)
      return daysPast <= 7 ? `${stamp} (last week)` : stamp
    }
    if (info.kind !== 'day') return undefined
    const date = info.date

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
