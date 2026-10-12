import { formatTrackingValue, type TrackingPoint } from '#lib/tracking/values.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'

export function TrackingChart({
  points,
  column,
  compact = false,
}: {
  points: TrackingPoint[]
  column: TrackingColumn
  compact?: boolean
}) {
  const numbers = points.flatMap((point) => (point.value === null ? [] : [point.value]))
  if (!numbers.length)
    return (
      <div className={compact ? 'sky-tracking-spark-empty' : 'sky-tracking-chart-empty'}>
        {points.some((point) => point.count)
          ? 'Your answers and notes are in the history below.'
          : 'Your first entry starts the picture.'}
      </div>
    )
  const sum = column.aggregate === 'sum'
  const width = compact ? 420 : 880,
    height = compact ? 64 : 250
  const left = compact ? 4 : 64,
    right = compact ? 4 : 12,
    top = compact ? 5 : 24,
    bottom = compact ? 5 : 40
  const minimum = Math.min(...numbers),
    maximum = Math.max(...numbers)
  const margin = Math.max((maximum - minimum) * 0.2, Math.abs(maximum) * 0.005, 0.1)
  const low = sum && minimum >= 0 ? 0 : minimum - margin
  const high = Math.max(sum && maximum <= 0 ? 0 : maximum + margin, low + margin)
  const x = (index: number) =>
    points.length === 1 ? (width + left - right) / 2 : left + (index * (width - left - right)) / (points.length - 1)
  const y = (value: number) => top + ((high - value) / (high - low)) * (height - top - bottom)
  let line = '',
    pen = false
  points.forEach((point, index) => {
    if (point.value === null) {
      pen = false
      return
    }
    line += `${pen ? 'L' : 'M'}${x(index).toFixed(2)} ${y(point.value).toFixed(2)} `
    pen = true
  })
  const barWidth = Math.max(1, Math.min(compact ? 8 : 14, ((width - left - right) / points.length) * 0.65))
  const label = `${column.name} from ${points[0].date} to ${points.at(-1)!.date}. Missing entries are gaps.`
  return (
    <svg
      className={compact ? 'sky-tracking-spark' : 'sky-tracking-chart'}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio={compact ? 'none' : 'xMidYMid meet'}
    >
      {!compact &&
        [0, 1, 2, 3, 4].map((tick) => {
          const value = low + (tick * (high - low)) / 4
          const text = formatTrackingValue(column, String(Number(value.toPrecision(3))))
          return (
            <g key={tick}>
              <line x1={left} y1={y(value)} x2={width - right} y2={y(value)} stroke="var(--sky-border-soft)" />
              <text x={left - 10} y={y(value) + 4} textAnchor="end">
                {text}
              </text>
            </g>
          )
        })}
      {!sum && (
        <path
          d={line}
          fill="none"
          stroke="var(--sky-accent)"
          strokeWidth={compact ? 2 : 2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map((point, index) => {
        if (point.value === null) return null
        const title = `${point.date}: ${formatTrackingValue(column, point.text)}`
        if (sum)
          return (
            <rect
              key={point.date}
              x={x(index) - barWidth / 2}
              y={y(Math.max(0, point.value))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(point.value) - y(0)))}
              rx={Math.min(3, barWidth / 2)}
              fill="var(--sky-accent)"
              opacity=".6"
            >
              <title>{title}</title>
            </rect>
          )
        if (numbers.length > 100 && points[index - 1]?.value != null && points[index + 1]?.value != null) return null
        return (
          <circle
            key={point.date}
            cx={x(index)}
            cy={y(point.value)}
            r={compact ? 2.5 : 4}
            fill="var(--sky-bg)"
            stroke="var(--sky-accent)"
            strokeWidth={compact ? 1.5 : 2}
          >
            <title>{title}</title>
          </circle>
        )
      })}
      {!compact &&
        [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].map((index, position, indices) => (
          <text
            key={index}
            x={x(index)}
            y={height - 8}
            textAnchor={position === 0 ? 'start' : position === indices.length - 1 ? 'end' : 'middle'}
          >
            {points[index].date}
          </text>
        ))}
    </svg>
  )
}
