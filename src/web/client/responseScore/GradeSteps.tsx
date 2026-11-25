import { useRef } from 'react'
import { RESPONSE_POINTS } from '#lib/needsResponse/marks.ts'
import { MARK_NAMES, MARK_NAMES_SHORT } from './markNames.ts'
import { useElementWidth } from './useElementWidth.ts'
import './GradeSteps.css'

/** The whole staircase in one sentence, for a reader who cannot see it. */
const IN_WORDS = `A reply earns ${MARK_NAMES.map((name, index) => `${RESPONSE_POINTS[index]} points inside ${name}`).join(', ')}, and nothing after that.`

/** What a reply earns as the wait grows: 100 until the first mark, 20 less after each one. */
export function GradeSteps() {
  const frame = useRef<HTMLDivElement>(null)
  const width = useElementWidth(frame) || 748
  const narrow = width < 520
  const height = narrow ? 250 : 286
  const margin = { top: 30, right: narrow ? 6 : 14, bottom: 58, left: 2 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const step = plotWidth / RESPONSE_POINTS.length
  const x = (index: number) => margin.left + step * index
  const y = (points: number) => margin.top + plotHeight * (1 - points / 100)
  const labels = narrow ? MARK_NAMES_SHORT : MARK_NAMES

  return (
    <div className="sky-rs-chart sky-rs-steps" ref={frame}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={IN_WORDS}>
        {[0, 20, 40, 60, 80, 100].map((line) => (
          <line
            key={line}
            className={line === 0 ? 'sky-rs-axis' : 'sky-rs-grid'}
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={y(line)}
            y2={y(line)}
          />
        ))}
        {!narrow && (
          <text className="sky-rs-mark" x={x(0)} y={height - 32}>
            Arrives
          </text>
        )}
        {labels.map((label, index) => (
          <g key={label}>
            <line className="sky-rs-axis" x1={x(index + 1)} x2={x(index + 1)} y1={y(0)} y2={y(0) + 7} />
            <text className="sky-rs-mark" x={x(index + 1)} y={height - 32} textAnchor="middle">
              {label}
            </text>
          </g>
        ))}
        <text className="sky-rs-axis-title" x={margin.left + plotWidth / 2} y={height - 8} textAnchor="middle">
          How long the message waited for you
        </text>
        {RESPONSE_POINTS.map((points, index) => (
          <g key={points}>
            {index > 0 && (
              <line
                className="sky-rs-axis"
                x1={x(index)}
                x2={x(index)}
                y1={y(RESPONSE_POINTS[index - 1])}
                y2={y(points)}
              />
            )}
            <line
              className="sky-rs-tread"
              data-level={5 - index}
              x1={x(index) + 3}
              x2={x(index + 1) - 3}
              y1={y(points)}
              y2={y(points)}
            />
            <text className="sky-rs-value" x={x(index) + step / 2} y={y(points) - 12} textAnchor="middle">
              {points}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
