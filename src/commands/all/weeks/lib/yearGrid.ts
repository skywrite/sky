/**
 * Year-at-a-glance grid of sky weeks (see #universal/dates/nbdt/Week).
 *
 * One row per month, three month rows bracketed per quarter. Each cell is
 * `W## dd–dd` — the week's in-year extent. A week sits on the row of the month
 * its first in-year day falls in: the same fact the v1.1 week directories
 * encode and the proposed `W##-MM` layout keeps
 * (nbfs/docs/2026-08-07-week-dir-layout.md), so the grid reads as a map of
 * `time/`. Cross-month cells show the spill honestly: `W14 30–05` on the Mar
 * row is the week filed under March that runs into April.
 *
 * Emphasis is temporal, and only when `today` falls inside the rendered year:
 * past weeks dim, the current week becomes a solid tile, the rest stay plain.
 * Other years render neutral — an all-past or all-future gradient says nothing.
 */
import picocolors from 'picocolors'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

type Colors = ReturnType<typeof picocolors.createColors>

export interface MonthRow {
  /** 1-12 */
  month: number
  /** Weeks whose first in-year day falls in this month, ascending */
  weeks: Week[]
}

export interface QuarterBlock {
  /** 1-4 */
  quarter: number
  months: [MonthRow, MonthRow, MonthRow]
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Every week of the year (W00/W53 buckets included), bucketed by first in-year day. */
export function buildYearGrid(year: number): QuarterBlock[] {
  const first = Week.of(new PlainDate(year, 1, 1)).number
  const last = Week.lastOfYear(year)

  const byMonth: Week[][] = Array.from({ length: 12 }, () => [])
  for (let number = first; number <= last; number++) {
    const week = Week.from(year, number)
    byMonth[week.startInYear.month - 1].push(week)
  }

  return [0, 1, 2, 3].map((q) => ({
    quarter: q + 1,
    months: [0, 1, 2].map((m) => ({ month: q * 3 + m + 1, weeks: byMonth[q * 3 + m] })) as QuarterBlock['months'],
  }))
}

export interface RenderYearGridOptions {
  /** Notebook today — enables past/now emphasis when it falls in `year`. */
  today?: PlainDate
  /** Color functions; inject `picocolors.createColors(false)` for plain output. */
  colors?: Colors
}

export function renderYearGrid(year: number, options: RenderYearGridOptions = {}): string[] {
  const c = options.colors ?? picocolors
  const { today } = options
  // "now" styling only when today's own week belongs to the rendered year, so
  // a Dec 29 sitting in next year's W00 doesn't light up the wrong page
  const now = today && Week.of(today).year === year ? Week.of(today) : undefined

  const firstNumber = Week.of(new PlainDate(year, 1, 1)).number
  const lastNumber = Week.lastOfYear(year)
  const grid = buildYearGrid(year)
  const accents = [c.cyan, c.green, c.yellow, c.magenta]

  const tile = (text: string): string => c.bgGreen(c.black(c.bold(text)))

  const chip = (week: Week): string => {
    const label = `W${pad2(week.number)}`
    const range = `${pad2(week.startInYear.day)}–${pad2(week.endInYear.day)}`
    if (now && week.number === now.number) return tile(`${label} ${range}`)
    if (now && week.number < now.number) return c.dim(`${label} ${range}`)
    return `${label} ${c.dim(range)}`
  }

  const monthLabel = (row: MonthRow): string => {
    const name = MONTH_NAMES[row.month - 1]
    if (now && row.weeks.some((w) => w.number === now.number)) return c.bold(name)
    if (now && row.weeks.every((w) => w.number < now.number)) return c.dim(name)
    return name
  }

  const lines: string[] = []
  const span = `W${pad2(firstNumber)}–W${pad2(lastNumber)}`
  lines.push(`  ${c.bold(String(year))} ${c.dim(`· ${span} · ${lastNumber - firstNumber + 1} weeks`)}`)

  if (now && today) {
    const left = lastNumber - now.number
    const remaining = left === 0 ? 'final week' : left === 1 ? '1 week left' : `${left} weeks left`
    const date = `${today.dayShort} ${MONTH_NAMES[today.month - 1]} ${today.day}`
    lines.push(`  ${c.dim('now')} ${tile(`W${pad2(now.number)}`)} ${c.dim(`· ${date} · ${remaining}`)}`)
  }

  const brackets = ['╭', '│', '╰']
  for (const block of grid) {
    lines.push('')
    const past = now !== undefined && block.months.every((m) => m.weeks.every((w) => w.number < now.number))
    const accent = accents[block.quarter - 1]
    block.months.forEach((row, i) => {
      const gutterText = `${i === 1 ? `Q${block.quarter}` : '  '} ${brackets[i]}`
      const gutter = past ? c.dim(accent(gutterText)) : accent(gutterText)
      lines.push(`  ${gutter}  ${monthLabel(row)}   ${row.weeks.map(chip).join('  ')}`)
    })
  }

  return lines
}
