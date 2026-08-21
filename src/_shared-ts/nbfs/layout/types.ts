import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** The one filename every layout agrees on: the day's own document. */
export const FILE_DAY = 'day.md'

/**
 * Where in the time tree a document lives, with the date span that level
 * covers. Day documents span a single day; week-, month-, and year-level
 * documents (a week plan, a week summary) span every day of their period.
 * (Only v1.1 has month-level documents - v2 has no month directories.)
 */
export type TimePathInfo =
  | { kind: 'day'; date: PlainDate; start: PlainDate; end: PlainDate }
  | { kind: 'week'; start: PlainDate; end: PlainDate }
  | { kind: 'month'; start: PlainDate; end: PlainDate }
  | { kind: 'year'; start: PlainDate; end: PlainDate }

/**
 * One notebook time-tree layout - the shape of paths under time/.
 *
 * Every layout obeys the same invariants, in precedence order: the year is
 * the boundary (a day files under its own calendar year, weeks clip at year
 * edges), days group into a week directory, and each day owns a directory
 * holding everything the day produced. What varies is only the naming in
 * between - whether a month container exists and what week and day dirs are
 * called.
 *
 * The pattern string is the layout's name in config (nbfs.layout) and
 * depicts the shape itself, e.g. "YYYY/W##/MM-DD".
 */
export interface NbfsLayout {
  pattern: string
  /** Week directory for a date, relative to time/ (e.g. "2026/W14"). */
  weekDir(date: PlainDate | string): string
  /** Day directory for a date, relative to time/ (e.g. "2026/W14/03-31"). */
  dayDir(date: PlainDate | string): string
  /** day.md path for a date, relative to time/. */
  dayFile(date: PlainDate | string): string
  /** Date of a day-file path. Throws when the path doesn't speak this layout. */
  parseDateFromDayPath(filePath: string): PlainDate
  /** Classify a time-tree document path - tolerant: null on foreign shapes. */
  parseTimePath(filePath: string): TimePathInfo | null
}
