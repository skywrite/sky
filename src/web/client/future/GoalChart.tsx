import { useLayoutEffect, useRef, useState } from 'react'
import type { FutureCheckpoint, FutureNumber } from '../../../service/handler/future/types.ts'
import { chartRange } from './chartGeometry.ts'
import { niceDate } from './dates.ts'

/**
 * A goal's number from the day work began, drawn through the goal's date when
 * that is still ahead: the recorded days, the target, the checkpoints, and the
 * straight line from today that the date needs.
 *
 * The chart draws in CSS pixels at its own measured width, so text and strokes
 * keep their size on a phone and on a wide screen.
 */
export function GoalChart({
  number,
  checkpoints,
  due,
  today,
}: {
  number: FutureNumber
  checkpoints: FutureCheckpoint[]
  due: string | null
  today: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(880)
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

  const { points, latest, target } = number
  const marks = checkpoints.filter((checkpoint) => checkpoint.day !== null)
  const range = chartRange([
    ...points.map((point) => point.value),
    ...marks.map((checkpoint) => checkpoint.value),
    ...(target === null ? [] : [target]),
  ])
  const label = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  const longest = range.ticks.reduce((most, tick) => Math.max(most, label(tick).length), 0)
  const height = width < 520 ? 230 : 300
  const pad = { top: 20, right: 20, bottom: 34, left: Math.min(96, Math.max(40, Math.round(longest * 7.4) + 16)) }
  const plotWidth = Math.max(1, width - pad.left - pad.right)
  const plotHeight = Math.max(1, height - pad.top - pad.bottom)
  const x = (day: number) => pad.left + (day / number.days) * plotWidth
  const y = (value: number) => pad.top + ((range.high - value) / (range.high - range.low)) * plotHeight
  const at = (day: number, value: number) => `${x(day).toFixed(1)} ${y(value).toFixed(1)}`
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${at(point.day, point.value)}`).join(' ')
  const needs = latest && target !== null && number.dueDay !== null && !number.reached
  // Today's label sits under its own mark unless it would run into the first or the last date.
  const todayFits = x(number.todayDay) - pad.left > 90 && pad.left + plotWidth - x(number.todayDay) > 90

  return (
    <div className="sky-future-chart" ref={frame}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${number.trackerTitle} since ${niceDate(number.from, today)}${
          latest ? `, ${latest.text} on ${niceDate(latest.date, today)}` : ''
        }${number.targetText ? `, toward ${number.targetText}` : ''}`}
      >
        {range.ticks.map((tick, index) => (
          <g key={tick}>
            <line className="sky-future-chart-grid" x1={pad.left} x2={pad.left + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end">
              {label(tick)}
              {index === range.ticks.length - 1 && number.unit ? ` ${number.unit}` : ''}
            </text>
          </g>
        ))}
        <text x={pad.left} y={height - 10}>
          {niceDate(number.from, today)}
        </text>
        {(todayFits || number.dueDay === null) && (
          <text x={x(number.todayDay)} y={height - 10} textAnchor={number.dueDay === null ? 'end' : 'middle'}>
            Today
          </text>
        )}
        {number.dueDay !== null && due && (
          <text x={x(number.dueDay)} y={height - 10} textAnchor="end">
            {niceDate(due, today)}
          </text>
        )}
        {target !== null && (
          <>
            <line
              className="sky-future-chart-target"
              x1={pad.left}
              x2={pad.left + plotWidth}
              y1={y(target)}
              y2={y(target)}
            />
            <text className="sky-future-chart-label" x={pad.left + 6} y={y(target) - 7}>
              {number.targetText}, the goal
            </text>
          </>
        )}
        {needs && (
          <line
            className="sky-future-chart-needs"
            x1={x(latest.day)}
            y1={y(latest.value)}
            x2={x(number.dueDay!)}
            y2={y(target)}
          />
        )}
        {marks.map((checkpoint) => (
          <rect
            key={checkpoint.date}
            className="sky-future-chart-checkpoint"
            data-state={checkpoint.state}
            x={x(checkpoint.day!) - 5}
            y={y(checkpoint.value) - 5}
            width={10}
            height={10}
            transform={`rotate(45 ${x(checkpoint.day!).toFixed(1)} ${y(checkpoint.value).toFixed(1)})`}
          >
            <title>
              {checkpoint.text} by {niceDate(checkpoint.date, today)}
            </title>
          </rect>
        ))}
        {points.length > 1 && <path className="sky-future-chart-line" d={line} />}
        {points.length <= 60 &&
          points.map((point) => (
            <circle key={point.date} className="sky-future-chart-dot" cx={x(point.day)} cy={y(point.value)} r={3}>
              <title>
                {niceDate(point.date, today)}: {point.text}
              </title>
            </circle>
          ))}
        {latest && (
          <>
            <circle className="sky-future-chart-latest" cx={x(latest.day)} cy={y(latest.value)} r={5.5} />
            <text
              className="sky-future-chart-label"
              x={x(latest.day)}
              y={y(latest.value) + (target !== null && target > latest.value ? 24 : -14)}
              textAnchor={x(latest.day) - pad.left < 80 ? 'start' : 'end'}
            >
              {latest.text}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}
