import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorkstreamColor } from '#lib/workstreams/colors.ts'
import { CARD_HEIGHT, CARD_WIDTH, defaultWorkstreamPosition } from '#lib/workstreams/layout.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type Bounds, type Camera, type Point, overviewCamera, revealCamera, worldAt } from '../lib/canvas/camera.ts'
import { Canvas } from '../lib/canvas/Canvas.tsx'
import { CanvasToolbar } from '../lib/canvas/CanvasToolbar.tsx'
import { snapRect, type SnapRect, type SnapResult } from '../lib/canvas/snap.ts'
import { SnapGuides } from '../lib/canvas/SnapGuides.tsx'
import { useCanvas, type DragHandler, type DragSession, type GestureContext } from '../lib/canvas/useCanvas.ts'
import { LaneInsertion } from './LaneInsertion.tsx'
import { LinkHint } from './LinkHint.tsx'
import { MapCard } from './MapCard.tsx'
import { type LaneGeometry, laneBeforeAt } from './order.ts'
import { RelationshipLines } from './RelationshipLines.tsx'
import { LABEL_WIDTH, TimelineGrid, WEEK_WIDTH } from './TimelineGrid.tsx'
import { TimelineRow } from './TimelineRow.tsx'
import { WorkstreamsCanvasHelp } from './WorkstreamsCanvasHelp.tsx'
import { WorkstreamsEmpty } from './WorkstreamsEmpty.tsx'
import { openWorkstreamMenu, type WorkstreamMenuTarget } from './WorkstreamsMenu.tsx'
import './WorkstreamsCanvas.css'

export interface CanvasActivity {
  id: string
  title: string
  kind: 'action' | 'decision'
  status: string
  start?: string
  end?: string
  requires: { workstreamId: string; activityId: string; result: string }[]
}
export interface CanvasWorkstream {
  id: string
  title: string
  outcome: string
  status: string
  assistance: string
  attention: string
  needsAttention: boolean
  position?: Point
  color?: WorkstreamColor
  parentId?: string
  relations: { targetId: string; kind: 'related' | 'contributes'; reason: string }[]
  activities: CanvasActivity[]
}
export interface CanvasRelationship {
  kind: 'related' | 'contributes' | 'parent' | 'prerequisite'
  /** The workstream that owns the relation, parent reference, or required result. */
  fromId: string
  toId: string
  reason: string
  activityId?: string
  requiredActivityId?: string
  proposalId?: string
}
export type WorkstreamView = 'map' | 'timeline'

function ordinal(date: PlainDate): number {
  const y = date.year - 1
  let count = y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + date.day
  for (let month = 1; month < date.month; month++) count += new PlainDate(date.year, month, 1).daysInMonth
  return count
}

export function dayOffset(from: string, to: string): number {
  return ordinal(PlainDate.from(to)) - ordinal(PlainDate.from(from))
}

function safeSavedSnapping(): boolean {
  try {
    return localStorage.getItem('sky-workstreams-snapping') !== 'false'
  } catch {
    return true
  }
}

export type LinkDrag = { fromId: string; start: Point; end: Point; toId?: string }

export function WorkstreamsCanvas({
  items,
  view,
  selected,
  today,
  onSelect,
  onMove,
  onSchedule,
  onReorder,
  onAdd,
  hasWorkstreams = false,
  onClearFilters,
  onMenu,
  onRelate,
  onInspectRelationship,
  relationshipPreviews = [],
  holdCamera = false,
  disabled,
}: {
  items: CanvasWorkstream[]
  view: WorkstreamView
  selected: string | null
  today: string
  onSelect: (id: string) => void
  onMove: (id: string, point: Point) => void | Promise<void>
  onSchedule: (id: string, activityId: string, days: number) => void | Promise<void>
  onReorder: (id: string, beforeId: string | null) => void | Promise<void>
  onAdd: (intent?: string) => void
  hasWorkstreams?: boolean
  onClearFilters?: () => void
  onMenu: (target: WorkstreamMenuTarget) => void
  onRelate: (fromId: string, toId?: string) => void
  onInspectRelationship: (relationship: CanvasRelationship) => void
  relationshipPreviews?: CanvasRelationship[]
  holdCamera?: boolean
  disabled: boolean
}) {
  const [moves, setMoves] = useState<Record<string, Point>>({})
  const [scheduleMoves, setScheduleMoves] = useState<Record<string, number>>({})
  const [laneDrag, setLaneDrag] = useState<{ id: string; delta: number; beforeId: string | null } | null>(null)
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null)
  const [snapping, setSnapping] = useState(safeSavedSnapping)
  const [snapFeedback, setSnapFeedback] = useState<SnapResult | null>(null)
  const revealed = useRef<string | null>(null)

  const monday = useMemo(() => {
    const date = PlainDate.from(today)
    return date.addDays(1 - date.dayOfWeek)
  }, [today])
  const positions = useMemo(
    () =>
      new Map(
        items.map((item, index) => [item.id, moves[item.id] ?? item.position ?? defaultWorkstreamPosition(index)]),
      ),
    [items, moves],
  )
  const lanes = useMemo(() => {
    let y = 92
    return new Map(
      items.map((item) => {
        const top = y
        const dated = item.activities.filter((activity) => !!activity.start).length
        const undated = item.activities.length - dated
        const height = Math.max(150 + undated * 48, 70 + dated * 48)
        y += height + 18
        return [item.id, { y: top, height }]
      }),
    )
  }, [items])
  const relationships = useMemo(() => {
    const result: CanvasRelationship[] = []
    for (const item of items) {
      for (const relation of item.relations) {
        result.push({ fromId: item.id, toId: relation.targetId, kind: relation.kind, reason: relation.reason })
      }
      if (item.parentId) result.push({ fromId: item.id, toId: item.parentId, kind: 'parent', reason: '' })
      for (const activity of item.activities)
        for (const requirement of activity.requires)
          result.push({
            fromId: item.id,
            toId: requirement.workstreamId,
            kind: 'prerequisite',
            activityId: activity.id,
            requiredActivityId: requirement.activityId,
            reason: requirement.result,
          })
    }
    return [...result, ...relationshipPreviews].filter(
      (relation) => positions.has(relation.fromId) && positions.has(relation.toId),
    )
  }, [items, positions, relationshipPreviews])
  const neighborhood = useMemo(() => {
    if (!selected || !positions.has(selected)) return null
    const neighbors = new Set([selected])
    for (const relationship of relationships) {
      if (relationship.fromId === selected) neighbors.add(relationship.toId)
      if (relationship.toId === selected) neighbors.add(relationship.fromId)
    }
    return neighbors
  }, [relationships, selected, positions])
  const earliestWeek = Math.min(
    0,
    ...items.flatMap((item) =>
      item.activities
        .filter((activity) => activity.start)
        .map((activity) => Math.floor(dayOffset(monday.ymd, activity.start!) / 7)),
    ),
  )
  const laneLeft = earliestWeek * WEEK_WIDTH
  const activityBox = useCallback(
    (item: CanvasWorkstream, activity: CanvasActivity) => {
      const index = item.activities
        .filter((value) => !!value.start === !!activity.start)
        .findIndex((value) => value.id === activity.id)
      return {
        x: activity.start
          ? LABEL_WIDTH + ((dayOffset(monday.ymd, activity.start) + (scheduleMoves[activity.id] ?? 0)) * WEEK_WIDTH) / 7
          : laneLeft,
        y: (activity.start ? 14 : 143) + index * 48,
        width: activity.start
          ? Math.max(155, (((activity.end ? dayOffset(activity.start, activity.end) : 0) + 1) * WEEK_WIDTH) / 7)
          : 265,
      }
    },
    [laneLeft, monday, scheduleMoves],
  )
  const boundsOf = useCallback(
    (id?: string): Bounds => {
      const visible = id ? items.filter((item) => item.id === id) : items
      if (!visible.length) return { x: 0, y: 0, width: 650, height: 400 }
      if (view === 'map') {
        const points = visible.map((item) => positions.get(item.id)!)
        const visibleIds = new Set(visible.map((item) => item.id))
        const linked = relationships.filter((edge) => visibleIds.has(edge.fromId) || visibleIds.has(edge.toId))
        const parallelCount = Math.max(
          1,
          ...linked.map(
            (edge) =>
              relationships.filter(
                (candidate) =>
                  (candidate.fromId === edge.fromId && candidate.toId === edge.toId) ||
                  (candidate.fromId === edge.toId && candidate.toId === edge.fromId),
              ).length,
          ),
        )
        const captionSpace = linked.length ? 90 + (parallelCount - 1) * 36 : 0
        const x = Math.min(...points.map((p) => p.x)),
          y = Math.min(...points.map((p) => p.y)) - captionSpace
        return {
          x,
          y,
          width: Math.max(...points.map((p) => p.x + CARD_WIDTH)) - x,
          height: Math.max(...points.map((p) => p.y + CARD_HEIGHT)) - y,
        }
      }
      let left = laneLeft,
        right = LABEL_WIDTH + WEEK_WIDTH * 4
      for (const item of visible)
        for (const activity of item.activities) {
          if (activity.start)
            left = Math.min(left, LABEL_WIDTH + (dayOffset(monday.ymd, activity.start) * WEEK_WIDTH) / 7)
          if (activity.end || activity.start)
            right = Math.max(
              right,
              LABEL_WIDTH + ((dayOffset(monday.ymd, activity.end ?? activity.start!) + 1) * WEEK_WIDTH) / 7,
            )
        }
      const y = Math.min(...visible.map((item) => lanes.get(item.id)!.y)) - 80
      return {
        x: left,
        y,
        width: right - left,
        height: Math.max(...visible.map((item) => lanes.get(item.id)!.y + lanes.get(item.id)!.height)) - y,
      }
    },
    [items, positions, lanes, view, monday, laneLeft, relationships],
  )

  const clearMove = (id: string) =>
    setMoves((old) => {
      const next = { ...old }
      delete next[id]
      return next
    })
  const mapSession = (id: string, event: PointerEvent, context: GestureContext): DragSession => {
    const origin = positions.get(id)!
    const peers: SnapRect[] = [...positions.entries()].map(([peerId, position]) => ({
      id: peerId,
      ...position,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }))
    const anchor = worldAt(context.camera, context.point)
    let pointer = context.point
    let modifiers = { altKey: event.altKey, shiftKey: event.shiftKey }
    let axis: 'x' | 'y' | undefined
    const update = (point: Point, keys: { altKey: boolean; shiftKey: boolean }): Point => {
      pointer = point
      modifiers = { altKey: keys.altKey, shiftKey: keys.shiftKey }
      const camera = context.current()
      const cursor = worldAt(camera, point)
      const delta = { x: cursor.x - anchor.x, y: cursor.y - anchor.y }
      if (!modifiers.shiftKey) axis = undefined
      else if (!axis) axis = Math.abs(delta.x) >= Math.abs(delta.y) ? 'x' : 'y'
      const raw = {
        x: origin.x + (axis === 'y' ? 0 : delta.x),
        y: origin.y + (axis === 'x' ? 0 : delta.y),
      }
      const visiblePeers = peers.filter((peer) => {
        const x = peer.x * camera.zoom + camera.x
        const y = peer.y * camera.zoom + camera.y
        return (
          x + peer.width * camera.zoom >= -80 &&
          y + peer.height * camera.zoom >= -80 &&
          x <= context.element.clientWidth + 80 &&
          y <= context.element.clientHeight + 80
        )
      })
      const result = snapRect({ ...raw, id, width: CARD_WIDTH, height: CARD_HEIGHT }, visiblePeers, camera.zoom, {
        disabled: !snapping || modifiers.altKey,
        axis,
      })
      setMoves((old) => ({ ...old, [id]: result.point }))
      setSnapFeedback(result.guides.length || result.gaps.length ? result : null)
      return result.point
    }
    return {
      move: (point, _delta, event) => void update(point, event),
      refresh: (keys) => void update(pointer, keys ?? modifiers),
      end: (point, _delta, moved, event) => {
        if (moved) {
          const finalPoint = update(point, event)
          void Promise.resolve(
            finalPoint.x !== origin.x || finalPoint.y !== origin.y ? onMove(id, finalPoint) : undefined,
          ).finally(() => clearMove(id))
        } else if (event.pointerType === 'touch') onSelect(id)
        setSnapFeedback(null)
      },
      cancel: () => {
        clearMove(id)
        setSnapFeedback(null)
      },
    }
  }
  const laneSession = (id: string, context: GestureContext): DragSession => {
    const geometry: LaneGeometry[] = [...lanes.entries()].map(([laneId, lane]) => ({ id: laneId, ...lane }))
    const zoom = context.camera.zoom
    return {
      move: (_point, delta) => {
        const change = delta.y / zoom
        setLaneDrag({ id, delta: change, beforeId: laneBeforeAt(geometry, id, change) })
      },
      end: (_point, delta, moved, event) => {
        if (moved)
          void Promise.resolve(onReorder(id, laneBeforeAt(geometry, id, delta.y / zoom))).finally(() =>
            setLaneDrag(null),
          )
        else if (event.pointerType === 'touch') onSelect(id)
      },
      cancel: () => setLaneDrag(null),
    }
  }
  const activitySession = (id: string, activityId: string, context: GestureContext): DragSession => {
    const zoom = context.camera.zoom
    const days = (delta: Point) => Math.round(delta.x / zoom / (WEEK_WIDTH / 7))
    return {
      move: (_point, delta) => setScheduleMoves((old) => ({ ...old, [activityId]: days(delta) })),
      end: (_point, delta, moved, event) => {
        if (moved) void Promise.resolve(onSchedule(id, activityId, days(delta))).finally(() => setScheduleMoves({}))
        else if (event.pointerType === 'touch') onSelect(id)
      },
      cancel: () => setScheduleMoves((old) => ({ ...old, [activityId]: 0 })),
    }
  }
  const linkSession = (connector: HTMLElement, context: GestureContext): DragSession => {
    const fromId = connector.dataset.workstreamConnector!
    const rect = connector.getBoundingClientRect()
    const point = worldAt(
      context.camera,
      context.local({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }),
    )
    setLinkDrag({ fromId, start: point, end: point })
    const over = (event: PointerEvent) =>
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-workstream]')?.dataset
        .workstream
    return {
      immediate: true,
      move: (point, _delta, event) => {
        const toId = over(event)
        setLinkDrag(
          (old) => old && { ...old, end: worldAt(context.current(), point), toId: toId !== fromId ? toId : undefined },
        )
      },
      end: (_point, _delta, moved, event) => {
        const toId = over(event)
        setLinkDrag(null)
        if (!disabled && (!moved || (toId && toId !== fromId))) onRelate(fromId, moved ? toId : undefined)
      },
      cancel: () => setLinkDrag(null),
    }
  }
  const drag: DragHandler = {
    control: (event, context) => {
      const target = event.target instanceof Element ? event.target : null
      const connector = target?.closest<HTMLElement>('[data-workstream-connector]')
      if (connector) {
        if (context.wantsPan) return 'pan'
        return disabled ? 'none' : linkSession(connector, context)
      }
      return target?.closest('[data-canvas-relationship]') && context.wantsPan ? 'pan' : 'none'
    },
    start: (event, context) => {
      const target = event.target instanceof Element ? event.target : null
      const node = target?.closest<HTMLElement>('[data-workstream]')
      if (!node) return 'pan'
      if (disabled) return 'none'
      const id = node.dataset.workstream!
      if (view === 'map') return mapSession(id, event, context)
      if (target?.closest('[data-lane-drag]')) return laneSession(id, context)
      const activity = target?.closest<HTMLElement>('[data-activity]')
      return activity?.dataset.scheduled === 'true' ? activitySession(id, activity.dataset.activity!, context) : 'pan'
    },
  }
  const canvas = useCanvas({
    persistKey: `sky-workstreams-camera-${view}`,
    drag,
    bounds: (selection) => (selection ? (selected ? boundsOf(selected) : null) : boundsOf()),
  })
  const { camera, size } = canvas

  // Before paint, so a view's first frame carries nothing from the previous view's drag.
  useLayoutEffect(() => {
    revealed.current = null
    setMoves({})
    setScheduleMoves({})
    setLaneDrag(null)
    setLinkDrag(null)
    setSnapFeedback(null)
  }, [view])

  useEffect(() => {
    if (!items.length) {
      revealed.current = null
      return
    }
    // The relationship editor highlights its source; the view stays where the person dragged the connector.
    if (holdCamera) return
    const key = selected ? `selected:${view}:${selected}` : `overview:${view}`
    const element = canvas.stage.current
    if (revealed.current === key || !element || (selected && !positions.has(selected))) return
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const detail = element.parentElement?.querySelector('.sky-workstream-detail')?.getBoundingClientRect()
    // Tablet details overlay part of the canvas. A full phone sheet hides the
    // canvas entirely; prepare its card underneath for when the sheet closes.
    const uncovered = detail ? Math.min(rect.width, detail.left - rect.left) : rect.width
    const width = uncovered >= 280 ? uncovered : rect.width
    const viewport = { x: width, y: rect.height }
    let next: Camera
    if (selected) {
      const bounds =
        view === 'map' ? { ...positions.get(selected)!, width: CARD_WIDTH, height: CARD_HEIGHT } : boundsOf(selected)
      next = revealCamera(canvas.current(), bounds, viewport)
    } else {
      const content =
        view === 'map'
          ? [...positions.values()].map((point) => ({ ...point, width: CARD_WIDTH, height: CARD_HEIGHT }))
          : items.flatMap((item) => {
              const lane = lanes.get(item.id)!
              return [
                { x: laneLeft, y: lane.y, width: 265, height: 80 },
                ...item.activities.map((activity) => {
                  const box = activityBox(item, activity)
                  return { ...box, y: lane.y + box.y, height: 38 }
                }),
              ]
            })
      next = overviewCamera(canvas.current(), content, viewport, boundsOf())
    }
    // Consume only once work and the viewport are ready. Polling and resizing
    // must not pull the camera back after the person deliberately pans away.
    revealed.current = key
    if (next !== canvas.current()) canvas.publish(next)
  }, [selected, view, positions, boundsOf, canvas, size, items, lanes, laneLeft, activityBox, holdCamera])

  const select = (id: string) => {
    if (canvas.canClick()) onSelect(id)
  }
  const changeSnapping = (next: boolean) => {
    setSnapping(next)
    try {
      localStorage.setItem('sky-workstreams-snapping', String(next))
    } catch {
      /* Snapping preferences are optional. */
    }
  }
  const firstWeek = Math.max(earliestWeek, Math.floor((-camera.x / camera.zoom - LABEL_WIDTH) / WEEK_WIDTH) - 1)
  const lastWeek = Math.ceil(((size.x - camera.x) / camera.zoom - LABEL_WIDTH) / WEEK_WIDTH) + 1
  const weeks = Array.from(
    { length: Math.min(100, Math.max(1, lastWeek - firstWeek + 1)) },
    (_, index) => firstWeek + index,
  )
  const totalHeight = Math.max(size.y / camera.zoom, ...[...lanes.values()].map((lane) => lane.y + lane.height))
  const laneY = (id: string) => lanes.get(id)!.y + (laneDrag?.id === id ? laneDrag.delta : 0)

  return (
    <Canvas
      canvas={canvas}
      className="sky-workstreams-canvas"
      data-view={view}
      data-linking={!!linkDrag}
      data-compact-empty={!items.length && size.y < 220}
      aria-label={`${view === 'map' ? 'Map' : 'Timeline'} of workstreams. Plus and minus zoom. Hold Space and drag to pan.`}
      onContextMenu={(event) => {
        if (view !== 'timeline' || (event.target instanceof Element && event.target.closest('[data-canvas-control]')))
          return
        const rect = event.currentTarget.getBoundingClientRect()
        const point = worldAt(canvas.current(), { x: event.clientX - rect.left, y: event.clientY - rect.top })
        if (point.x < laneLeft) return
        const item = items.find((candidate) => {
          const lane = lanes.get(candidate.id)!
          return point.y >= lane.y && point.y <= lane.y + lane.height
        })
        if (item) openWorkstreamMenu(event, item.id, item.title, onMenu)
      }}
      overlay={
        <>
          {linkDrag && <LinkHint overTarget={!!linkDrag.toId} />}
          {!items.length && (
            <WorkstreamsEmpty
              onStart={onAdd}
              disabled={disabled}
              hasWorkstreams={hasWorkstreams}
              onClearFilters={onClearFilters}
              availableHeight={size.y}
            />
          )}
          <CanvasToolbar
            canvas={canvas}
            snapping={snapping}
            snappingLabel="Snap to workstreams"
            onSnappingChange={view === 'map' ? changeSnapping : undefined}
            help={<WorkstreamsCanvasHelp view={view} />}
          />
        </>
      }
    >
      <RelationshipLines
        relationships={relationships}
        items={items}
        layout={{ view, positions, laneLeft, laneY, activityBox }}
        selected={selected}
        neighborhood={neighborhood}
        zoom={camera.zoom}
        linkDrag={linkDrag}
        canClick={canvas.canClick}
        onInspect={onInspectRelationship}
      />
      {view === 'map' && snapFeedback && <SnapGuides feedback={snapFeedback} zoom={camera.zoom} />}
      {view === 'map' ? (
        <>
          {items.map((item) => (
            <MapCard
              key={item.id}
              item={item}
              point={positions.get(item.id)!}
              selected={item.id === selected}
              muted={!!neighborhood && !neighborhood.has(item.id)}
              dropTarget={linkDrag?.toId === item.id}
              zoom={camera.zoom}
              disabled={disabled}
              onOpen={select}
              onMenu={onMenu}
              onRelate={onRelate}
            />
          ))}
        </>
      ) : (
        <>
          <TimelineGrid
            weeks={weeks}
            monday={monday}
            todayLeft={LABEL_WIDTH + (dayOffset(monday.ymd, today) * WEEK_WIDTH) / 7}
            laneLeft={laneLeft}
            height={totalHeight}
          />
          {items.map((item) => (
            <TimelineRow
              key={item.id}
              item={item}
              top={laneY(item.id)}
              height={lanes.get(item.id)!.height}
              laneLeft={laneLeft}
              dragging={laneDrag?.id === item.id}
              selected={selected === item.id}
              muted={!!neighborhood && !neighborhood.has(item.id)}
              dropTarget={linkDrag?.toId === item.id}
              zoom={camera.zoom}
              disabled={disabled}
              activityBox={activityBox}
              onOpen={select}
              onMenu={onMenu}
              onRelate={onRelate}
            />
          ))}
          {laneDrag && (
            <LaneInsertion
              laneLeft={laneLeft}
              top={
                laneDrag.beforeId
                  ? lanes.get(laneDrag.beforeId)!.y - 9
                  : Math.max(...[...lanes.values()].map((lane) => lane.y + lane.height)) + 9
              }
            />
          )}
        </>
      )}
    </Canvas>
  )
}
