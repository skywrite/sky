import type { Key } from 'react'
import { CARD_HEIGHT, CARD_WIDTH } from '#lib/workstreams/layout.ts'
import type { Point } from './camera.ts'
import type { ActivityBox } from './TimelineRow.tsx'
import type {
  CanvasActivity,
  CanvasRelationship,
  CanvasWorkstream,
  LinkDrag,
  WorkstreamView,
} from './WorkstreamsCanvas.tsx'

export type RelationshipLayout = {
  view: WorkstreamView
  positions: Map<string, Point>
  laneLeft: number
  laneY: (id: string) => number
  activityBox: (item: CanvasWorkstream, activity: CanvasActivity) => ActivityBox
}

export function RelationshipLines({
  relationships,
  items,
  layout,
  selected,
  neighborhood,
  zoom,
  linkDrag,
  canClick,
  onInspect,
}: {
  relationships: CanvasRelationship[]
  items: CanvasWorkstream[]
  layout: RelationshipLayout
  selected: string | null
  neighborhood: Set<string> | null
  zoom: number
  linkDrag: LinkDrag | null
  canClick: () => boolean
  onInspect: (relationship: CanvasRelationship) => void
}) {
  return (
    <svg
      className="sky-workstreams-edges sky-workstreams-relationship-graph"
      aria-label="Relationships between workstreams"
    >
      <defs>
        <marker
          id="workstream-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </marker>
      </defs>
      {relationships.map((relationship, index) => {
        const { fromId, toId, kind } = relationship
        if (layout.view === 'map' && fromId === toId) return null
        const from = items.find((item) => item.id === fromId)!
        const to = items.find((item) => item.id === toId)!
        const parallel = relationships.filter(
          (candidate) =>
            (candidate.fromId === fromId && candidate.toId === toId) ||
            (candidate.fromId === toId && candidate.toId === fromId),
        )
        const focused = selected === fromId || selected === toId
        return (
          <RelationshipLine
            key={`${kind}:${fromId}:${toId}:${relationship.activityId ?? ''}:${relationship.requiredActivityId ?? ''}:${relationship.proposalId ?? ''}`}
            relationship={relationship}
            from={from}
            to={to}
            curve={relationshipCurve(relationship, index, parallel, from, to, layout)}
            focused={focused}
            muted={!!neighborhood && !focused}
            zoom={zoom}
            onClick={() => {
              if (canClick()) onInspect(relationship)
            }}
            onActivate={() => onInspect(relationship)}
          />
        )
      })}
      {linkDrag && (
        <path
          className="sky-workstreams-link-preview"
          d={`M ${linkDrag.start.x} ${linkDrag.start.y} C ${linkDrag.start.x + 65} ${linkDrag.start.y}, ${linkDrag.end.x - 65} ${linkDrag.end.y}, ${linkDrag.end.x} ${linkDrag.end.y}`}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

function RelationshipLine({
  relationship,
  from,
  to,
  curve,
  focused,
  muted,
  zoom,
  onClick,
  onActivate,
}: {
  key?: Key | null
  relationship: CanvasRelationship
  from: CanvasWorkstream
  to: CanvasWorkstream
  curve: { path: string; midpoint: Point }
  focused: boolean
  muted: boolean
  zoom: number
  onClick: () => void
  onActivate: () => void
}) {
  const { kind, reason } = relationship
  const requiredActivity = to.activities.find((activity) => activity.id === relationship.requiredActivityId)
  const description =
    kind === 'prerequisite'
      ? `${from.title} needs a result from ${to.title}${reason ? `: ${reason}` : ''}`
      : `${from.title} ${kind === 'parent' ? 'is part of' : kind === 'contributes' ? 'contributes to' : 'is related to'} ${to.title}${reason ? `: ${reason}` : ''}`
  const label =
    kind === 'prerequisite'
      ? `Needs: ${reason || requiredActivity?.title || 'a result'}`
      : kind === 'parent'
        ? 'Part of'
        : kind === 'contributes'
          ? 'Contributes to'
          : 'Related to'
  const shortLabel = `${relationship.proposalId ? 'Sky suggests · ' : ''}${label.length > 42 ? `${label.slice(0, 39)}…` : label}`
  const labelWidth = Math.max(82, shortLabel.length * 6.4 + 24)
  return (
    <g
      className="sky-workstreams-relationship"
      data-kind={kind}
      data-focused={focused}
      data-muted={muted}
      data-preview={!!relationship.proposalId}
    >
      <path
        className="sky-workstreams-relationship-line"
        d={curve.path}
        markerEnd={kind === 'related' ? undefined : 'url(#workstream-arrow)'}
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="sky-workstreams-relationship-hit"
        d={curve.path}
        data-canvas-control
        data-canvas-relationship
        role="button"
        tabIndex={0}
        aria-label={`${relationship.proposalId ? 'Review Sky suggestion: ' : 'Inspect relationship: '}${description}`}
        vectorEffect="non-scaling-stroke"
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onActivate()
          }
        }}
      >
        <title>{description}</title>
      </path>
      <g
        className="sky-workstreams-relationship-label"
        transform={`translate(${curve.midpoint.x}, ${curve.midpoint.y}) scale(${1 / zoom})`}
        data-canvas-control
        data-canvas-relationship
        onClick={onClick}
        aria-hidden="true"
      >
        <rect x={-labelWidth / 2} y={-14} width={labelWidth} height={28} rx={14} />
        <text textAnchor="middle" dominantBaseline="central">
          {shortLabel}
        </text>
      </g>
    </g>
  )
}

function relationshipCurve(
  relationship: CanvasRelationship,
  index: number,
  parallel: CanvasRelationship[],
  from: CanvasWorkstream,
  to: CanvasWorkstream,
  { view, positions, laneLeft, laneY, activityBox }: RelationshipLayout,
): { path: string; midpoint: Point } {
  const { fromId, toId, kind } = relationship
  const requiredActivity = to.activities.find((activity) => activity.id === relationship.requiredActivityId)
  const dependentActivity = from.activities.find((activity) => activity.id === relationship.activityId)
  let start: Point, end: Point, first: Point, second: Point
  if (view === 'map') {
    // A prerequisite arrow runs from the supplying work to the activity that needs it.
    const source = positions.get(kind === 'prerequisite' ? toId : fromId)!
    const target = positions.get(kind === 'prerequisite' ? fromId : toId)!
    const direction = target.x >= source.x ? 1 : -1
    const portGap = Math.min(26, (CARD_HEIGHT - 32) / Math.max(1, parallel.length - 1))
    const separation = (parallel.indexOf(relationship) - (parallel.length - 1) / 2) * portGap
    start = { x: source.x + (direction === 1 ? CARD_WIDTH : 0), y: source.y + CARD_HEIGHT / 2 + separation }
    end = { x: target.x + (direction === 1 ? 0 : CARD_WIDTH), y: target.y + CARD_HEIGHT / 2 + separation }
    const bend = Math.max(65, Math.abs(end.x - start.x) / 2)
    first = { x: start.x + direction * bend, y: start.y }
    second = { x: end.x - direction * bend, y: end.y }
    if (Math.abs(source.y - target.y) < CARD_HEIGHT / 2) {
      // Leave the row clear, including any other cards between these workstreams.
      const lift = 40 + parallel.indexOf(relationship) * 36
      start = { x: source.x + CARD_WIDTH / 2, y: source.y }
      end = { x: target.x + CARD_WIDTH / 2, y: target.y }
      first = { x: start.x, y: Math.min(start.y, end.y) - lift }
      second = { x: end.x, y: Math.min(start.y, end.y) - lift }
    }
  } else if (kind === 'prerequisite' && requiredActivity && dependentActivity) {
    const source = activityBox(to, requiredActivity)
    const target = activityBox(from, dependentActivity)
    start = { x: source.x + source.width, y: laneY(toId) + source.y + 18 }
    end = { x: target.x, y: laneY(fromId) + target.y + 18 }
    first = { x: start.x + 55, y: start.y }
    second = { x: end.x - 55, y: end.y }
  } else {
    const supplier = kind === 'prerequisite' ? toId : fromId
    const recipient = kind === 'prerequisite' ? fromId : toId
    start = { x: laneLeft + 265, y: laneY(supplier) + 40 }
    end = { x: laneLeft + 265, y: laneY(recipient) + 40 }
    const bend = 80 + (index % 4) * 22
    first = { x: start.x + bend, y: start.y }
    second = { x: end.x + bend, y: end.y }
  }
  const path = `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`
  const labelT = parallel.length > 1 ? 0.3 + (0.4 * parallel.indexOf(relationship)) / (parallel.length - 1) : 0.5
  const inverse = 1 - labelT
  const midpoint = {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * labelT * first.x +
      3 * inverse * labelT ** 2 * second.x +
      labelT ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * labelT * first.y +
      3 * inverse * labelT ** 2 * second.y +
      labelT ** 3 * end.y,
  }
  return { path, midpoint }
}
