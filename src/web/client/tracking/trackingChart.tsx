import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTrackingValue, type TrackingPoint } from '#lib/tracking/values.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { axisDate, barPath, chartScale, pointDate, spreadIndices, tickLabel } from './trackingScale.ts'

/**
 * The chart draws in CSS pixels: it measures its own box and sizes the drawing to
 * it, so text, dots, and strokes keep their size on every card width. Hover and
 * keyboard pick the recorded day nearest the pointer; the readout is an HTML
 * tooltip anchored at that point.
 */
export function TrackingChart({
  points,
  column,
  compact = false,
}: {
  points: TrackingPoint[]
  column: TrackingColumn
  compact?: boolean
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(compact ? 420 : 880)
  const [hover, setHover] = useState<number | null>(null)
  const washId = `sky-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const sum = column.aggregate === 'sum'
  const recorded = useMemo(() => points.flatMap((point, index) => (point.value === null ? [] : [index])), [points])

  useLayoutEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = Math.round(element.clientWidth)
      if (next) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A touch leaves no pointer to move away, so a tap outside clears the readout.
  useEffect(() => {
    if (hover === null) return
    const clear = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) setHover(null)
    }
    document.addEventListener('pointerdown', clear)
    return () => document.removeEventListener('pointerdown', clear)
  }, [hover])

  const chart = useMemo(() => {
    if (!recorded.length) return null
    const scale = chartScale(
      column,
      recorded.map((index) => points[index]!.value!),
      sum,
      !compact,
    )
    const height = compact ? 64 : width < 520 ? 220 : 260
    const labels = scale.ticks.map((tick, index) => tickLabel(column, tick, index === scale.ticks.length - 1))
    const longest = labels.reduce((most, label) => Math.max(most, label.length), 0)
    const pad = compact
      ? { top: 6, right: 6, bottom: 6, left: 6 }
      : { top: 18, right: 18, bottom: 36, left: Math.min(104, Math.max(44, Math.round(longest * 7.2) + 16)) }
    const plotWidth = Math.max(1, width - pad.left - pad.right)
    const plotHeight = Math.max(1, height - pad.top - pad.bottom)
    const slot = plotWidth / Math.max(1, points.length - 1)
    const x = (index: number) => (points.length === 1 ? pad.left + plotWidth / 2 : pad.left + index * slot)
    const y = (value: number) => pad.top + ((scale.high - value) / (scale.high - scale.low)) * plotHeight
    const floor = pad.top + plotHeight
    const baseline = y(Math.min(Math.max(0, scale.low), scale.high))
    const at = (index: number) =>
      `${(Math.round(x(index) * 100) / 100).toString()} ${(Math.round(y(points[index]!.value!) * 100) / 100).toString()}`
    const runs: number[][] = []
    for (const index of recorded) {
      const run = runs.at(-1)
      if (run && run.at(-1) === index - 1) run.push(index)
      else runs.push([index])
    }
    const lines = runs.filter((run) => run.length > 1)
    const line = sum ? '' : lines.map((run) => run.map((index, k) => `${k ? 'L' : 'M'}${at(index)}`).join('')).join('')
    // The wash follows a trend, not a hop: two lone points washed read as a bar.
    const wash = sum
      ? ''
      : lines
          .filter((run) => run.length > 2)
          .map((run) => {
            const bottom = Math.round(floor * 100) / 100
            const [first] = run,
              last = run.at(-1)!
            return `M${Math.round(x(first!) * 100) / 100} ${bottom}${run.map((index) => `L${at(index)}`).join('')}L${Math.round(x(last) * 100) / 100} ${bottom}Z`
          })
          .join('')
    const barWidth = Math.max(1.5, Math.min(24, slot * 0.7))
    const radius = Math.min(4, barWidth / 2)
    const bars = sum
      ? recorded.map((index) => ({
          index,
          d: barPath(x(index) - barWidth / 2, barWidth, y(points[index]!.value!), baseline, radius),
        }))
      : []
    const everyDot = !compact && slot >= 14
    const lastRecorded = recorded.at(-1)
    const dots = sum
      ? []
      : recorded.filter(
          (index) =>
            everyDot ||
            index === lastRecorded ||
            (points[index - 1]?.value == null && points[index + 1]?.value == null),
        )
    const withYear = points[0]!.date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4)
    const dates = compact
      ? []
      : spreadIndices(points.length, Math.max(2, Math.min(7, Math.floor(plotWidth / (withYear ? 150 : 110)) + 1)))
    return {
      height,
      pad,
      x,
      y,
      floor,
      baseline,
      scale,
      labels,
      line,
      wash,
      bars,
      barWidth,
      radius,
      dots,
      dates,
      withYear,
    }
  }, [points, column, compact, width, recorded, sum])

  if (!chart)
    return (
      <div className={compact ? 'sky-tracking-spark-empty' : 'sky-tracking-chart-empty'}>
        {points.some((point) => point.count)
          ? 'Your answers and notes are in the history below.'
          : 'Your first entry starts the picture.'}
      </div>
    )

  /** The recorded day nearest a pointer position, measured against the plot's own box. */
  const locate = (clientX: number): number | null => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return null
    const pointer = clientX - box.left
    let best: number | null = null,
      closest = Infinity
    for (const index of recorded) {
      const gap = Math.abs(chart.x(index) - pointer)
      if (gap > closest) break
      closest = gap
      best = index
    }
    return best
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') {
      setHover(null)
      return
    }
    const current = hover === null ? -1 : recorded.indexOf(hover)
    const next = {
      ArrowLeft: current < 0 ? recorded.length - 1 : current - 1,
      ArrowRight: current < 0 ? 0 : current + 1,
      Home: 0,
      End: recorded.length - 1,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setHover(recorded[Math.max(0, Math.min(recorded.length - 1, next))]!)
  }

  const point = hover !== null && points[hover]?.value != null ? points[hover]! : null
  const px = point ? chart.x(hover!) : 0,
    py = point ? chart.y(point.value!) : 0
  const align = px < 100 ? 'start' : width - px < 100 ? 'end' : 'center'
  const below = py < 60
  const label = `${column.name} from ${points[0]!.date} to ${points.at(-1)!.date}. Missing entries are gaps.`
  return (
    <div ref={frame} className={compact ? 'sky-tracking-plot sky-tracking-plot-compact' : 'sky-tracking-plot'}>
      <svg
        className={compact ? 'sky-tracking-spark' : 'sky-tracking-chart'}
        width="100%"
        height={chart.height}
        viewBox={`0 0 ${width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        tabIndex={compact ? undefined : 0}
        onPointerMove={(event) => setHover(locate(event.clientX))}
        onPointerDown={(event) => setHover(locate(event.clientX))}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setHover(null)
        }}
        onBlur={() => setHover(null)}
        onKeyDown={compact ? undefined : onKeyDown}
      >
        <defs>
          <linearGradient id={washId} className="sky-tracking-wash" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopOpacity={compact ? 0.22 : 0.18} />
            <stop offset="1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {chart.scale.ticks.map((tick, index) => {
          const at = Math.round(chart.y(tick)) + 0.5
          return (
            <g key={tick}>
              <line className="sky-tracking-grid" x1={chart.pad.left} x2={width - chart.pad.right} y1={at} y2={at} />
              <text className="sky-tracking-axis" x={chart.pad.left - 10} y={at + 4} textAnchor="end">
                {chart.labels[index]}
              </text>
            </g>
          )
        })}
        {chart.wash && <path className="sky-tracking-area" d={chart.wash} fill={`url(#${washId})`} />}
        {chart.line && <path className="sky-tracking-line" d={chart.line} />}
        {chart.bars.map((bar) => (
          <path key={bar.index} className="sky-tracking-bar" d={bar.d} />
        ))}
        {chart.dots.map((index) => (
          <circle
            key={index}
            className="sky-tracking-dot"
            cx={chart.x(index)}
            cy={chart.y(points[index]!.value!)}
            r={compact ? 3 : 4}
          />
        ))}
        {chart.dates.map((index, position, all) => (
          <text
            key={index}
            className="sky-tracking-axis"
            x={chart.x(index)}
            y={chart.height - 10}
            textAnchor={position === 0 ? 'start' : position === all.length - 1 ? 'end' : 'middle'}
          >
            {axisDate(points[index]!.date, chart.withYear)}
          </text>
        ))}
        {point && !sum && (
          <>
            <line
              className="sky-tracking-guide"
              x1={Math.round(px) + 0.5}
              x2={Math.round(px) + 0.5}
              y1={chart.pad.top}
              y2={chart.floor}
            />
            <circle className="sky-tracking-halo" cx={px} cy={py} r={compact ? 9 : 12} />
            <circle className="sky-tracking-dot-hot" cx={px} cy={py} r={compact ? 4 : 5} />
          </>
        )}
        {point && sum && (
          <path
            className="sky-tracking-bar sky-tracking-bar-hot"
            d={barPath(px - chart.barWidth / 2, chart.barWidth, py, chart.baseline, chart.radius)}
          />
        )}
      </svg>
      {point && (
        <div
          className={`sky-tracking-tip sky-tracking-tip-${align}${below ? ' sky-tracking-tip-below' : ''}`}
          style={{ left: px, top: py }}
          aria-hidden="true"
        >
          <strong>{formatTrackingValue(column, point.text)}</strong>
          <span>
            {pointDate(point.date)}
            {point.count > 1 ? ` · ${point.count} entries` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
