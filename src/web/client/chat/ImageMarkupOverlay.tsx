import type { SVGProps } from 'react'
import { imageMarkupShapes, MARKUP_COLOR, type ImageMarkup } from '#universal/ai/imageMarkup.ts'

export function ImageMarkupOverlay({ markup, ...props }: { markup: ImageMarkup } & SVGProps<SVGSVGElement>) {
  const { stroke, radius, shapes } = imageMarkupShapes(markup)
  return (
    <svg viewBox={`0 0 ${markup.width} ${markup.height}`} {...props}>
      {shapes.map((shape) => (
        <g key={shape.number}>
          <path
            d={shape.d}
            fill="none"
            stroke={MARKUP_COLOR}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={shape.x} cy={shape.y} r={radius} fill={MARKUP_COLOR} />
          <text
            x={shape.x}
            y={shape.y + radius * 0.36}
            textAnchor="middle"
            fontFamily="sans-serif"
            fontSize={radius * 1.3}
            fontWeight="bold"
            fill="white"
          >
            {shape.number}
          </text>
        </g>
      ))}
    </svg>
  )
}
