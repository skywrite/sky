import * as path from 'node:path'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import parseDateFromDayPath from './parseDateFromDayPath.ts'

/**
 * Compute a `previous` time-ref from a full saved-message path.
 *
 * Returns a relative reference whose format depends on the relationship
 * between the previous message's date and the current message's date:
 *   - Same month/year:  DD/subpath
 *   - Same year:        MM-DD/subpath
 *   - Different year:   YYYY-MM-DD/subpath
 *
 * @param prevTimePath  Full path like "time/2026/03/16-22/03-21/actions/messages/email_Foo.md"
 * @param curDate       The date of the message being created (NOT today)
 */
export default function computePreviousRef(prevTimePath: string, curDate: PlainDate): string {
  const prevDate = parseDateFromDayPath(prevTimePath)
  // Subpath is everything below the day dir: time/YYYY/MM/DD-DD/<day>/<subpath>.
  // Positional so both v1.1 (MM-DD) and legacy (DD, xDD) day dirs work.
  const parts = prevTimePath.split(path.sep)
  const subpath = parts
    .slice(parts.indexOf('time') + 5)
    .join('/')
    .replace(/\.md$/, '')
  const dd = String(prevDate.day).padStart(2, '0')
  const mm = String(prevDate.month).padStart(2, '0')
  if (prevDate.year === curDate.year && prevDate.month === curDate.month) {
    return `${dd}/${subpath}`
  } else if (prevDate.year === curDate.year) {
    return `${mm}-${dd}/${subpath}`
  } else {
    return `${prevDate.year}-${mm}-${dd}/${subpath}`
  }
}
