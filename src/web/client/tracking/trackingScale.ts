import { formatTrackingValue, minutesPerUnit } from '#lib/tracking/values.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Gridline spacing for durations, in minutes: the steps a clock reader expects. */
const CLOCK_STEPS = [
  1 / 60,
  2 / 60,
  5 / 60,
  10 / 60,
  15 / 60,
  30 / 60,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  180,
  240,
  360,
  480,
  720,
  1440,
  2880,
  4320,
  10080,
]

const round = (value: number) => Number(value.toPrecision(12))

/** A round gridline step (1, 2 or 5 × 10ⁿ, or a clock step) that cuts the span into about five intervals. */
export function niceStep(span: number, steps?: number[]): number {
  const raw = Math.max(span, Number.MIN_VALUE) / 5
  if (steps) {
    const largest = steps.at(-1)!
    return steps.find((step) => step >= raw) ?? largest * Math.ceil(raw / largest)
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / magnitude
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude
}

export interface ChartScale {
  low: number
  high: number
  /** Gridline values in the column's own unit, lowest first. Empty for a sparkline. */
  ticks: number[]
}

/**
 * The value axis. Totals grow from zero; other series zoom to their own range so
 * day-to-day movement stays visible, but never past zero when nothing was recorded
 * on the other side of it. `nice` snaps the bounds to round gridlines; a sparkline
 * skips that and fills its height.
 */
export function chartScale(column: TrackingColumn, numbers: number[], sum: boolean, nice: boolean): ChartScale {
  const perUnit = column.type === 'duration' ? (minutesPerUnit(column.unit) ?? 60) : 1
  const values = numbers.map((n) => n * perUnit)
  const minimum = Math.min(...values),
    maximum = Math.max(...values)
  const pad = (maximum - minimum) * (nice ? 0.05 : 0.08) || Math.abs(maximum) * 0.02 || 1
  let low = sum && minimum >= 0 ? 0 : Math.max(minimum - pad, minimum >= 0 ? 0 : -Infinity)
  let high = sum && maximum <= 0 ? 0 : Math.min(maximum + pad, maximum <= 0 ? 0 : Infinity)
  if (high <= low) high = low + pad
  if (!nice) return { low: low / perUnit, high: high / perUnit, ticks: [] }
  const step = niceStep(high - low, column.type === 'duration' ? CLOCK_STEPS : undefined)
  low = Math.floor(low / step + 1e-9) * step
  high = Math.ceil(high / step - 1e-9) * step
  const ticks: number[] = []
  for (let value = low; value <= high + step / 2; value += step) ticks.push(round(value / perUnit))
  return { low: round(low / perUnit), high: round(high / perUnit), ticks }
}

/** A gridline label. The unit rides only the top line so the axis stays quiet. */
export function tickLabel(column: TrackingColumn, value: number, withUnit: boolean): string {
  if (column.type === 'duration') return formatTrackingValue(column, String(value))
  const text =
    Math.abs(value) >= 10_000
      ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
      : value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return withUnit && column.unit ? `${text} ${column.unit}` : text
}

/** 'Sep 5', or 'Sep 5, 2025' when the range crosses a year boundary. */
export function axisDate(ymd: string, withYear: boolean): string {
  const [year, month, day] = ymd.split('-')
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day) || day}${withYear ? `, ${year}` : ''}`
}

/** 'Mon, Sep 21, 2026' for the hover readout. */
export function pointDate(ymd: string): string {
  let weekday = ''
  try {
    weekday = new PlainDate(ymd).dayShort
  } catch {
    // A malformed date still reads as written.
  }
  return `${weekday ? `${weekday}, ` : ''}${axisDate(ymd, true)}`
}

/** Up to `slots` evenly spread indices into a list of `count`, always including both ends. */
export function spreadIndices(count: number, slots: number): number[] {
  if (count <= 0) return []
  const wanted = Math.min(Math.max(1, slots), count)
  if (wanted === 1) return [0]
  const picks = new Set<number>()
  for (let k = 0; k < wanted; k++) picks.add(Math.round((k * (count - 1)) / (wanted - 1)))
  return [...picks]
}

const px = (value: number) => String(Math.round(value * 100) / 100 || 0)

/** A column with rounded data-end corners and a square foot on the baseline. A zero still shows as a 1px foot. */
export function barPath(x: number, width: number, top: number, base: number, radius: number): string {
  const upward = top <= base
  if (Math.abs(base - top) < 1) top = upward ? base - 1 : base + 1
  const r = Math.min(radius, width / 2, Math.abs(base - top) / 2)
  const shoulder = upward ? top + r : top - r
  return (
    `M${px(x)} ${px(base)}V${px(shoulder)}Q${px(x)} ${px(top)} ${px(x + r)} ${px(top)}` +
    `H${px(x + width - r)}Q${px(x + width)} ${px(top)} ${px(x + width)} ${px(shoulder)}V${px(base)}Z`
  )
}
