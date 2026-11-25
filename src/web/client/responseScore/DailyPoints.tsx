import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import type { ResponseScoreDay } from '#lib/needsResponse/earned.ts'
import { shortDay, weekdayOf } from './dayLabel.ts'
import { axisStep } from './scale.ts'
import { useElementWidth } from './useElementWidth.ts'
import './DailyPoints.css'

const HEIGHT = 236

/** A column standing on the baseline, its top corners rounded. */
function column(x: number, top: number, base: number, width: number): string {
  const radius = Math.min(4, width / 2, (base - top) / 2)
  return `M${x},${base} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${base} Z`
}

const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`

/** Points earned each day: one column a day, today last. Point at a day, or use the arrow keys, to read it. */
export function DailyPoints({ days }: { days: readonly ResponseScoreDay[] }) {
  const frame = useRef<HTMLDivElement>(null)
  const width = useElementWidth(frame) || 748
  const [picked, setPicked] = useState<number | null>(null)
  if (days.length === 0) return null

  const last = days.length - 1
  const shown = days[picked ?? last]
  const narrow = width < 520
  const margin = { top: 12, right: 6, bottom: 30, left: 46 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = HEIGHT - margin.top - margin.bottom
  const step = axisStep(Math.max(...days.map((day) => day.points)))
  const slot = plotWidth / days.length
  const bar = Math.max(3, Math.min(24, slot - (narrow ? 3 : 6)))
  const left = (index: number) => margin.left + slot * index + (slot - bar) / 2
  const y = (points: number) => margin.top + plotHeight * (1 - points / (step * 4))
  const labelled = narrow ? [0, Math.floor(last / 2), last] : [0, 7, 14, 21, last].filter((index) => index <= last)

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const at = ((event.clientX - box.left) / box.width) * width
    setPicked(Math.max(0, Math.min(last, Math.floor((at - margin.left) / slot))))
  }
  const move = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const by = event.key === 'ArrowLeft' ? -1 : 1
    setPicked((current) => Math.max(0, Math.min(last, (current ?? last) + by)))
  }

  return (
    <div className="sky-rs-daily">
      <p className="sky-rs-daily-readout" aria-live="polite">
        <b>
          {weekdayOf(shown.date)} {shortDay(shown.date)}
        </b>
        {count(shown.points, 'point', 'points')} from {count(shown.replies, 'reply', 'replies')}
      </p>
      <div className="sky-rs-chart" ref={frame}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label="Points earned each day over the last 30 days. Use the left and right arrow keys to read a day."
          tabIndex={0}
          onPointerMove={point}
          onPointerDown={point}
          onPointerLeave={() => setPicked(null)}
          onKeyDown={move}
          onBlur={() => setPicked(null)}
        >
          {[0, 1, 2, 3, 4].map((line) => (
            <g key={line}>
              <line
                className={line === 0 ? 'sky-rs-axis' : 'sky-rs-grid'}
                x1={margin.left}
                x2={margin.left + plotWidth}
                y1={y(step * line)}
                y2={y(step * line)}
              />
              <text x={margin.left - 10} y={y(step * line) + 4.5} textAnchor="end">
                {(step * line).toLocaleString('en-US')}
              </text>
            </g>
          ))}
          {labelled.map((index) => (
            <text
              key={index}
              x={index === 0 ? left(0) : index === last ? left(last) + bar : left(index) + bar / 2}
              y={HEIGHT - 8}
              textAnchor={index === 0 ? 'start' : index === last ? 'end' : 'middle'}
            >
              {shortDay(days[index].date)}
            </text>
          ))}
          {picked !== null && (
            <rect
              className="sky-rs-daily-band"
              x={margin.left + slot * picked}
              y={margin.top}
              width={slot}
              height={plotHeight}
            />
          )}
          {days.map(
            (day, index) =>
              day.points > 0 && (
                <path key={day.date} className="sky-rs-daily-bar" d={column(left(index), y(day.points), y(0), bar)} />
              ),
          )}
        </svg>
      </div>
      <details className="sky-rs-numbers">
        <summary>Show the numbers</summary>
        <div className="sky-rs-numbers-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Points</th>
                <th scope="col">Replies</th>
              </tr>
            </thead>
            <tbody>
              {days.toReversed().map((day) => (
                <tr key={day.date}>
                  <td>
                    {weekdayOf(day.date)} {shortDay(day.date)}
                  </td>
                  <td>{day.points.toLocaleString('en-US')}</td>
                  <td>{day.replies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
