import type { SnapResult } from './workstreamsSnap.ts'

export function WorkstreamGuides({ feedback, zoom }: { feedback: SnapResult; zoom: number }) {
  const tick = 3 / zoom
  return (
    <svg className="sky-workstreams-snap-guides" aria-hidden="true">
      {feedback.guides.map((guide, index) => {
        const vertical = guide.axis === 'x'
        const start = vertical ? { x: guide.value, y: guide.from } : { x: guide.from, y: guide.value }
        const end = vertical ? { x: guide.value, y: guide.to } : { x: guide.to, y: guide.value }
        return (
          <g key={`align-${index}`} className="sky-workstreams-alignment-guide">
            <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} vectorEffect="non-scaling-stroke" />
            {[start, end].map((point, endpoint) => (
              <path
                key={endpoint}
                d={`M ${point.x - tick} ${point.y - tick} l ${tick * 2} ${tick * 2} m ${-tick * 2} 0 l ${tick * 2} ${-tick * 2}`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )
      })}
      {feedback.gaps.map((gap, index) => {
        const horizontal = gap.from.y === gap.to.y
        const center = { x: (gap.from.x + gap.to.x) / 2, y: (gap.from.y + gap.to.y) / 2 }
        const label = String(Math.round(gap.distance * 10) / 10)
        const width = Math.max(24, label.length * 7 + 10)
        return (
          <g key={`gap-${index}`} className="sky-workstreams-spacing-guide">
            <path d={`M ${gap.from.x} ${gap.from.y} L ${gap.to.x} ${gap.to.y}`} vectorEffect="non-scaling-stroke" />
            {[gap.from, gap.to].map((point, endpoint) => (
              <path
                key={endpoint}
                d={
                  horizontal
                    ? `M ${point.x} ${point.y - tick} v ${tick * 2}`
                    : `M ${point.x - tick} ${point.y} h ${tick * 2}`
                }
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <g transform={`translate(${center.x}, ${center.y}) scale(${1 / zoom})`}>
              <rect x={-width / 2} y={-9} width={width} height={18} rx={5} />
              <text textAnchor="middle" dominantBaseline="central">
                {label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}
