import * as path from 'node:path'
import { FILE_DAY } from '#shared/nbfs/layout/mod.ts'
import { toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Day-dir name in any layout the notebook has written: MM-DD, legacy DD / xDD. */
export function isDayDirName(name: string): boolean {
  return /^x?\d{1,2}$/.test(name) || /^\d{2}-\d{2}$/.test(name)
}

/**
 * The date a day directory encodes, in any layout the notebook has ever
 * written - or null when the directory is not a day directory.
 *
 * A day dir is a day dir with or without a day file, so the probe is the
 * day file the directory would hold: toTimeRef reads a date out of
 * `<dir>/day.md` exactly when the path around the day dir has a layout's
 * shape, and the ref it returns is exactly `YYYY-MM-DD/day.md` only when
 * the directory sits at day depth. Name shape alone is not enough: a v1.1
 * month directory (`08`) and a one-day week range (`01-01`) look like day
 * dirs but the probe cannot parse them, and a digit-named directory nested
 * inside a real day (`actions/05`) parses to that day with a longer
 * subpath. Both come back null.
 */
export default function dayDirDate(dir: string): PlainDate | null {
  if (!isDayDirName(path.basename(dir))) return null
  let ref: string
  try {
    ref = toTimeRef(path.join(dir, FILE_DAY))
  } catch {
    return null
  }
  const [ymd, ...subpath] = ref.split('/')
  if (subpath.length !== 1) return null
  return new PlainDate(ymd)
}
