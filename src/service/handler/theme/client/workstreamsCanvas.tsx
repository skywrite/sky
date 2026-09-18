import { ActionIcon, Button } from '@mantine/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkstreamColor } from '#lib/workstreams/colors.ts'
import { CARD_HEIGHT, CARD_WIDTH, defaultWorkstreamPosition } from '#lib/workstreams/layout.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type Bounds,
  type Camera,
  type Point,
  fitCamera,
  overviewCamera,
  pinchCamera,
  readCamera,
  revealCamera,
  wheelCamera,
  worldAt,
  zoomAt,
} from './workstreamsCamera.ts'
import { workstreamColorStyle } from './workstreamsColors.tsx'
import { WorkstreamsEmpty } from './workstreamsEmpty.tsx'
import { WorkstreamGuides } from './workstreamsGuides.tsx'
import { openWorkstreamMenu, WorkstreamMenuButton, type WorkstreamMenuTarget } from './workstreamsMenu.tsx'
import { type LaneGeometry, laneBeforeAt } from './workstreamsOrder.ts'
import { snapWorkstream, type SnapRect, type SnapResult } from './workstreamsSnap.ts'
import './workstreamsRelationshipsCanvas.css'

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
const WEEK_WIDTH = 252
const LABEL_WIDTH = 300

function ordinal(date: PlainDate): number {
  const y = date.year - 1
  let count = y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + date.day
  for (let month = 1; month < date.month; month++) count += new PlainDate(date.year, month, 1).daysInMonth
  return count
}

export function dayOffset(from: string, to: string): number {
  return ordinal(PlainDate.from(to)) - ordinal(PlainDate.from(from))
}

function safeSavedCamera(view: WorkstreamView): Camera {
  try {
    return readCamera(JSON.parse(localStorage.getItem(`sky-workstreams-camera-${view}`) ?? 'null'))
  } catch {
    return readCamera(null)
  }
}

function saveCamera(view: WorkstreamView, camera: Camera): void {
  try {
    localStorage.setItem(`sky-workstreams-camera-${view}`, JSON.stringify(camera))
  } catch {
    /* Camera preferences are optional. */
  }
}

function safeSavedSnapping(): boolean {
  try {
    return localStorage.getItem('sky-workstreams-snapping') !== 'false'
  } catch {
    return true
  }
}

type Gesture = {
  pointer: number
  start: Point
  camera: Camera
  moved: boolean
  id?: string
  position?: Point
  activity?: string
  lanes?: LaneGeometry[]
  map?: {
    peers: SnapRect[]
    pointer: Point
    axis?: 'x' | 'y'
    altKey: boolean
    shiftKey: boolean
  }
  kind: 'pan' | 'map' | 'activity' | 'lane' | 'link'
}
type LinkDrag = { fromId: string; start: Point; end: Point; toId?: string }
type Pinch = { camera: Camera; anchor: Point; distance: number }
type SafariGesture = Event & { clientX: number; clientY: number; scale: number }

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
  disabled: boolean
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState(() => safeSavedCamera(view))
  const cameraRef = useRef(camera)
  const cameraView = useRef(view)
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [panning, setPanning] = useState(false)
  const [size, setSize] = useState({ x: 1000, y: 700 })
  const [moves, setMoves] = useState<Record<string, Point>>({})
  const [scheduleMoves, setScheduleMoves] = useState<Record<string, number>>({})
  const [laneDrag, setLaneDrag] = useState<{ id: string; delta: number; beforeId: string | null } | null>(null)
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null)
  const [snapping, setSnapping] = useState(safeSavedSnapping)
  const snappingRef = useRef(snapping)
  snappingRef.current = snapping
  const [snapFeedback, setSnapFeedback] = useState<SnapResult | null>(null)
  const [help, setHelp] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<Pinch | null>(null)
  const space = useRef(false)
  const suppressClick = useRef(false)
  const frame = useRef<number | null>(null)
  const revealed = useRef<string | null>(null)
  const callbacks = useRef({ onSelect, onMove, onSchedule, onReorder, onRelate, items, disabled, tool, view })
  callbacks.current = { onSelect, onMove, onSchedule, onReorder, onRelate, items, disabled, tool, view }
  const publish = useCallback((next: Camera) => {
    cameraRef.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setCamera(cameraRef.current)
      saveCamera(cameraView.current, cameraRef.current)
    })
  }, [])
  useEffect(() => {
    if (cameraView.current !== view && frame.current !== null) {
      saveCamera(cameraView.current, cameraRef.current)
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    revealed.current = null
    cameraView.current = view
    cameraRef.current = safeSavedCamera(view)
    setCamera(cameraRef.current)
    setMoves({})
    setScheduleMoves({})
    setLaneDrag(null)
    setLinkDrag(null)
    setSnapFeedback(null)
    gesture.current = null
  }, [view, publish])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setSize({ x: element.clientWidth, y: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])

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
  const laneGeometry = useRef<LaneGeometry[]>([])
  laneGeometry.current = [...lanes.entries()].map(([id, lane]) => ({ id, ...lane }))
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
  const fit = useCallback((id?: string) => publish(fitCamera(boundsOf(id), size)), [boundsOf, size, publish])
  const fitRef = useRef(fit)
  fitRef.current = fit
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const positionsRef = useRef(positions)
  positionsRef.current = positions

  useEffect(() => {
    if (!items.length) {
      revealed.current = null
      return
    }
    const key = selected ? `selected:${view}:${selected}` : `overview:${view}`
    const element = stage.current
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
      next = revealCamera(cameraRef.current, bounds, viewport)
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
      next = overviewCamera(cameraRef.current, content, viewport, boundsOf())
    }
    // Consume only once work and the viewport are ready. Polling and resizing
    // must not pull the camera back after the person deliberately pans away.
    revealed.current = key
    if (next !== cameraRef.current) publish(next)
  }, [selected, view, positions, boundsOf, publish, size, items, lanes, laneLeft, activityBox])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const local = (event: { clientX: number; clientY: number }): Point => {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const chrome = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('[data-canvas-control]')
    const editing = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
    const rollback = () => {
      const current = gesture.current
      if (current?.kind === 'map' && current.id && current.position)
        setMoves((old) => {
          const next = { ...old }
          delete next[current.id!]
          return next
        })
      setSnapFeedback(null)
      if (current?.activity) setScheduleMoves((old) => ({ ...old, [current.activity!]: 0 }))
      if (current?.kind === 'lane') setLaneDrag(null)
      if (current?.kind === 'link') setLinkDrag(null)
    }
    const updateMapDrag = (
      current: Gesture,
      point: Point,
      modifiers: { altKey: boolean; shiftKey: boolean },
    ): Point | undefined => {
      if (!current.map || !current.id || !current.position) return
      const anchor = worldAt(current.camera, current.start)
      const pointer = worldAt(cameraRef.current, point)
      const delta = { x: pointer.x - anchor.x, y: pointer.y - anchor.y }
      const map = current.map
      map.pointer = point
      map.altKey = modifiers.altKey
      map.shiftKey = modifiers.shiftKey
      if (!modifiers.shiftKey) map.axis = undefined
      else if (!map.axis) map.axis = Math.abs(delta.x) >= Math.abs(delta.y) ? 'x' : 'y'
      const raw = {
        x: current.position.x + (map.axis === 'y' ? 0 : delta.x),
        y: current.position.y + (map.axis === 'x' ? 0 : delta.y),
      }
      const camera = cameraRef.current
      const visiblePeers = map.peers.filter((peer) => {
        const x = peer.x * camera.zoom + camera.x
        const y = peer.y * camera.zoom + camera.y
        return (
          x + peer.width * camera.zoom >= -80 &&
          y + peer.height * camera.zoom >= -80 &&
          x <= element.clientWidth + 80 &&
          y <= element.clientHeight + 80
        )
      })
      const result = snapWorkstream(
        { ...raw, id: current.id, width: CARD_WIDTH, height: CARD_HEIGHT },
        visiblePeers,
        camera.zoom,
        { disabled: !snappingRef.current || modifiers.altKey, axis: map.axis },
      )
      setMoves((old) => ({ ...old, [current.id!]: result.point }))
      setSnapFeedback(result.guides.length || result.gaps.length ? result : null)
      return result.point
    }
    const refreshMapDrag = () => {
      const current = gesture.current
      if (current?.kind === 'map' && current.moved && current.map)
        updateMapDrag(current, current.map.pointer, current.map)
    }
    const down = (event: PointerEvent) => {
      const connector =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-workstream-connector]') : null
      const edge = event.target instanceof Element && event.target.closest('[data-canvas-relationship]')
      const wantsPan = event.button === 1 || space.current || callbacks.current.tool === 'hand'
      if (event.button === 2 || (chrome(event.target) && !connector && !(edge && wantsPan))) return
      suppressClick.current = false
      element.focus({ preventScroll: true })
      if (connector && !wantsPan && !callbacks.current.disabled) {
        const fromId = connector.dataset.workstreamConnector!
        const rect = connector.getBoundingClientRect()
        const point = worldAt(
          cameraRef.current,
          local({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }),
        )
        gesture.current = {
          pointer: event.pointerId,
          start: local(event),
          camera: cameraRef.current,
          moved: false,
          kind: 'link',
          id: fromId,
        }
        setLinkDrag({ fromId, start: point, end: point })
        element.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
      if (event.pointerType === 'touch') {
        pointers.current.set(event.pointerId, local(event))
        element.setPointerCapture(event.pointerId)
        if (pointers.current.size === 2) {
          rollback()
          const [a, b] = [...pointers.current.values()]
          const center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
          pinch.current = {
            camera: cameraRef.current,
            anchor: worldAt(cameraRef.current, center),
            distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          }
          gesture.current = null
          suppressClick.current = true
          event.preventDefault()
          return
        }
      }
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-workstream]') : null
      const activity = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-activity]') : null
      const lane = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-lane-drag]') : null
      const pan = event.button === 1 || space.current || callbacks.current.tool === 'hand' || !node
      const kind = pan
        ? 'pan'
        : callbacks.current.view === 'map'
          ? 'map'
          : lane
            ? 'lane'
            : activity?.dataset.scheduled === 'true'
              ? 'activity'
              : 'pan'
      if (!pan && callbacks.current.disabled) return
      gesture.current = {
        pointer: event.pointerId,
        start: local(event),
        camera: cameraRef.current,
        moved: false,
        id: node?.dataset.workstream,
        position: node ? positionsRef.current.get(node.dataset.workstream!) : undefined,
        activity: activity?.dataset.activity,
        lanes: kind === 'lane' ? laneGeometry.current.map((value) => ({ ...value })) : undefined,
        map:
          kind === 'map'
            ? {
                peers: [...positionsRef.current.entries()].map(([id, position]) => ({
                  id,
                  ...position,
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                })),
                pointer: local(event),
                altKey: event.altKey,
                shiftKey: event.shiftKey,
              }
            : undefined,
        kind,
      }
      if (pan) {
        setPanning(true)
        element.setPointerCapture(event.pointerId)
        event.preventDefault()
      }
    }
    const move = (event: PointerEvent) => {
      if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, local(event))
      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        publish(
          pinchCamera(
            pinch.current.camera,
            pinch.current.anchor,
            { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
            Math.hypot(a!.x - b!.x, a!.y - b!.y) / Math.max(1, pinch.current.distance),
          ),
        )
        return
      }
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      const point = local(event),
        delta = { x: point.x - current.start.x, y: point.y - current.start.y }
      if (Math.hypot(delta.x, delta.y) > 3) {
        current.moved = true
        suppressClick.current = true
        element.setPointerCapture(event.pointerId)
      }
      if (!current.moved) return
      if (current.kind === 'link') {
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-workstream]')
        const toId = target?.dataset.workstream
        setLinkDrag(
          (old) =>
            old && { ...old, end: worldAt(cameraRef.current, point), toId: toId !== current.id ? toId : undefined },
        )
      } else if (current.kind === 'pan')
        publish({ ...current.camera, x: current.camera.x + delta.x, y: current.camera.y + delta.y })
      else if (current.kind === 'map' && current.id && current.position) updateMapDrag(current, point, event)
      else if (current.kind === 'lane' && current.id && current.lanes) {
        const change = delta.y / current.camera.zoom
        setLaneDrag({ id: current.id, delta: change, beforeId: laneBeforeAt(current.lanes, current.id, change) })
      } else if (current.activity)
        setScheduleMoves((old) => ({
          ...old,
          [current.activity!]: Math.round(delta.x / current.camera.zoom / (WEEK_WIDTH / 7)),
        }))
    }
    const up = (event: PointerEvent) => {
      const current = gesture.current
      pointers.current.delete(event.pointerId)
      if (current?.pointer === event.pointerId) {
        if (event.type === 'pointercancel') rollback()
        else if (current.kind === 'link' && current.id) {
          const target = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-workstream]')
          const toId = target?.dataset.workstream
          setLinkDrag(null)
          suppressClick.current = true
          if (!callbacks.current.disabled && (!current.moved || (toId && toId !== current.id)))
            callbacks.current.onRelate(current.id, current.moved ? toId : undefined)
        } else if (current.moved && current.id) {
          const point = local(event),
            delta = { x: point.x - current.start.x, y: point.y - current.start.y }
          if (current.kind === 'map' && current.position) {
            const finalPoint = updateMapDrag(current, point, event) ?? current.position
            void Promise.resolve(
              finalPoint.x !== current.position.x || finalPoint.y !== current.position.y
                ? callbacks.current.onMove(current.id, finalPoint)
                : undefined,
            ).finally(() =>
              setMoves((old) => {
                const next = { ...old }
                delete next[current.id!]
                return next
              }),
            )
          } else if (current.kind === 'lane' && current.lanes) {
            void Promise.resolve(
              callbacks.current.onReorder(
                current.id,
                laneBeforeAt(current.lanes, current.id, delta.y / current.camera.zoom),
              ),
            ).finally(() => setLaneDrag(null))
          } else if (current.kind === 'activity' && current.activity) {
            void Promise.resolve(
              callbacks.current.onSchedule(
                current.id,
                current.activity,
                Math.round(delta.x / current.camera.zoom / (WEEK_WIDTH / 7)),
              ),
            ).finally(() => setScheduleMoves({}))
          }
        } else if (!current.moved && current.id && event.pointerType === 'touch') callbacks.current.onSelect(current.id)
        gesture.current = null
        setSnapFeedback(null)
      }
      if (pointers.current.size < 2) pinch.current = null
      if (pointers.current.size === 1) {
        const [pointer, point] = [...pointers.current.entries()][0]!
        gesture.current = { pointer, start: point, camera: cameraRef.current, moved: true, kind: 'pan' }
      }
      if (!pointers.current.size) setPanning(false)
      setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
    const wheel = (event: WheelEvent) => {
      if (
        chrome(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-canvas-relationship], [data-workstream-connector]')
        )
      )
        return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      publish(
        wheelCamera(cameraRef.current, local(event), {
          x: event.deltaX * unit,
          y: event.deltaY * unit,
          zoom: event.ctrlKey || event.metaKey,
          shift: event.shiftKey,
        }),
      )
      refreshMapDrag()
    }
    let safari: Pinch | null = null
    const safariStart = (event: Event) => {
      event.preventDefault()
      if (gesture.current?.kind === 'map') {
        rollback()
        gesture.current = null
        suppressClick.current = true
      }
      safari = {
        camera: cameraRef.current,
        anchor: worldAt(cameraRef.current, local(event as SafariGesture)),
        distance: 1,
      }
    }
    const safariChange = (event: Event) => {
      event.preventDefault()
      if (safari)
        publish(
          pinchCamera(safari.camera, safari.anchor, local(event as SafariGesture), (event as SafariGesture).scale),
        )
    }
    const safariEnd = (event: Event) => {
      event.preventDefault()
      safari = null
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (gesture.current?.kind === 'link' || gesture.current?.kind === 'map')) {
        event.preventDefault()
        rollback()
        gesture.current = null
        suppressClick.current = true
        return
      }
      if ((event.key === 'Alt' || event.key === 'Shift') && gesture.current?.kind === 'map' && gesture.current.moved) {
        const current = gesture.current
        if (current.map) updateMapDrag(current, current.map.pointer, event)
        return
      }
      if (chrome(event.target) || editing(event.target) || document.querySelector('[role="dialog"], [role="menu"]'))
        return
      if (event.code === 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        space.current = true
        setPanning(true)
        return
      }
      const key = event.key.toLowerCase(),
        center = { x: element.clientWidth / 2, y: element.clientHeight / 2 }
      if (event.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(event.code)) {
        event.preventDefault()
        if (event.code === 'Digit0') publish(zoomAt(cameraRef.current, 1, center))
        if (event.code === 'Digit1') fitRef.current()
        if (event.code === 'Digit2' && selectedRef.current) fitRef.current(selectedRef.current)
      } else if (['+', '=', '-', '_'].includes(key)) {
        event.preventDefault()
        publish(zoomAt(cameraRef.current, cameraRef.current.zoom * (key === '+' || key === '=' ? 1.25 : 0.8), center))
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && (key === 'h' || key === 'v')) {
        event.preventDefault()
        setTool(key === 'h' ? 'hand' : 'select')
      }
      refreshMapDrag()
    }
    const keyup = (event: KeyboardEvent) => {
      if ((event.key === 'Alt' || event.key === 'Shift') && gesture.current?.kind === 'map' && gesture.current.moved) {
        const current = gesture.current
        if (current.map) updateMapDrag(current, current.map.pointer, event)
      }
      if (event.code === 'Space') {
        space.current = false
        setPanning(false)
      }
    }
    const blur = () => {
      space.current = false
      rollback()
      gesture.current = null
      pinch.current = null
      pointers.current.clear()
      setPanning(false)
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('gesturestart', safariStart)
    element.addEventListener('gesturechange', safariChange)
    element.addEventListener('gestureend', safariEnd)
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', blur)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('gesturestart', safariStart)
      element.removeEventListener('gesturechange', safariChange)
      element.removeEventListener('gestureend', safariEnd)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', blur)
    }
  }, [publish])

  const select = (id: string) => {
    if (!suppressClick.current && !space.current && tool !== 'hand') onSelect(id)
  }
  const firstWeek = Math.max(earliestWeek, Math.floor((-camera.x / camera.zoom - LABEL_WIDTH) / WEEK_WIDTH) - 1)
  const lastWeek = Math.ceil(((size.x - camera.x) / camera.zoom - LABEL_WIDTH) / WEEK_WIDTH) + 1
  const weeks = Array.from(
    { length: Math.min(100, Math.max(1, lastWeek - firstWeek + 1)) },
    (_, index) => firstWeek + index,
  )
  const totalHeight = Math.max(size.y / camera.zoom, ...[...lanes.values()].map((lane) => lane.y + lane.height))
  const center = { x: size.x / 2, y: size.y / 2 }
  const laneY = (id: string) => lanes.get(id)!.y + (laneDrag?.id === id ? laneDrag.delta : 0)
  const drawRelationship = (relationship: CanvasRelationship, index: number) => {
    const { fromId, toId, kind, reason } = relationship
    if (view === 'map' && fromId === toId) return null
    const from = items.find((item) => item.id === fromId)!
    const to = items.find((item) => item.id === toId)!
    const requiredActivity = to.activities.find((activity) => activity.id === relationship.requiredActivityId)
    const dependentActivity = from.activities.find((activity) => activity.id === relationship.activityId)
    const parallel = relationships.filter(
      (candidate) =>
        (candidate.fromId === fromId && candidate.toId === toId) ||
        (candidate.fromId === toId && candidate.toId === fromId),
    )
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
    const focused = selected === fromId || selected === toId
    const labelWidth = Math.max(82, shortLabel.length * 6.4 + 24)
    const inspect = () => {
      if (!suppressClick.current && !space.current && tool !== 'hand') onInspectRelationship(relationship)
    }
    return (
      <g
        key={`${kind}:${fromId}:${toId}:${relationship.activityId ?? ''}:${relationship.requiredActivityId ?? ''}:${relationship.proposalId ?? ''}`}
        className="sky-workstreams-relationship"
        data-kind={kind}
        data-focused={focused}
        data-muted={!!neighborhood && !focused}
        data-preview={!!relationship.proposalId}
      >
        <path
          className="sky-workstreams-relationship-line"
          d={path}
          markerEnd={kind === 'related' ? undefined : 'url(#workstream-arrow)'}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="sky-workstreams-relationship-hit"
          d={path}
          data-canvas-control
          data-canvas-relationship
          role="button"
          tabIndex={0}
          aria-label={`${relationship.proposalId ? 'Review Sky suggestion: ' : 'Inspect relationship: '}${description}`}
          vectorEffect="non-scaling-stroke"
          onClick={inspect}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onInspectRelationship(relationship)
            }
          }}
        >
          <title>{description}</title>
        </path>
        <g
          className="sky-workstreams-relationship-label"
          transform={`translate(${midpoint.x}, ${midpoint.y}) scale(${1 / camera.zoom})`}
          data-canvas-control
          data-canvas-relationship
          onClick={inspect}
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
  const connector = (item: CanvasWorkstream) => (
    <ActionIcon
      className="sky-workstreams-connector"
      aria-label={`Relate ${item.title} to another workstream`}
      title="Drag to another workstream to relate them, or click to choose."
      variant="secondary"
      data-canvas-control
      data-workstream-connector={item.id}
      disabled={disabled}
      style={{ transform: `translate(50%, -50%) scale(${1 / camera.zoom})` }}
      onClick={(event) => {
        if (event.detail === 0 && !disabled) onRelate(item.id)
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M8 5H5a5 5 0 0 0 0 10h3m4-10h3a5 5 0 0 1 0 10h-3M6 10h8" />
      </svg>
    </ActionIcon>
  )

  return (
    <div
      ref={stage}
      className="sky-workstreams-canvas"
      data-view={view}
      data-panning={panning || tool === 'hand'}
      data-linking={!!linkDrag}
      data-compact-empty={!items.length && size.y < 220}
      tabIndex={0}
      aria-label={`${view === 'map' ? 'Map' : 'Timeline'} of workstreams. Plus and minus zoom. Hold Space and drag to pan.`}
      style={{ backgroundPosition: `${camera.x % 24}px ${camera.y % 24}px` }}
      onContextMenu={(event) => {
        if (view !== 'timeline' || (event.target instanceof Element && event.target.closest('[data-canvas-control]')))
          return
        const rect = event.currentTarget.getBoundingClientRect()
        const point = worldAt(cameraRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top })
        if (point.x < laneLeft) return
        const item = items.find((candidate) => {
          const lane = lanes.get(candidate.id)!
          return point.y >= lane.y && point.y <= lane.y + lane.height
        })
        if (item) openWorkstreamMenu(event, item.id, item.title, onMenu)
      }}
    >
      <div
        className="sky-workstreams-world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
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
          {relationships.map(drawRelationship)}
          {linkDrag && (
            <path
              className="sky-workstreams-link-preview"
              d={`M ${linkDrag.start.x} ${linkDrag.start.y} C ${linkDrag.start.x + 65} ${linkDrag.start.y}, ${linkDrag.end.x - 65} ${linkDrag.end.y}, ${linkDrag.end.x} ${linkDrag.end.y}`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {view === 'map' && snapFeedback && <WorkstreamGuides feedback={snapFeedback} zoom={camera.zoom} />}
        {view === 'map' ? (
          <>
            {items.map((item) => {
              const point = positions.get(item.id)!
              const openActivities = item.activities.filter(
                (activity) => activity.status !== 'done' && activity.status !== 'decided',
              ).length
              const summary =
                item.status === 'active'
                  ? item.attention ||
                    `Active · ${openActivities} open ${openActivities === 1 ? 'activity' : 'activities'}`
                  : item.status === 'proposed'
                    ? 'Proposed'
                    : item.status === 'paused'
                      ? 'Paused'
                      : item.status === 'completed'
                        ? 'Completed'
                        : 'Canceled'
              return (
                <div
                  key={item.id}
                  className="sky-workstreams-card"
                  data-workstream={item.id}
                  data-state={item.status}
                  data-color={item.color ?? 'blue'}
                  data-attention={item.needsAttention}
                  data-selected={item.id === selected}
                  data-muted={!!neighborhood && !neighborhood.has(item.id)}
                  data-drop-target={linkDrag?.toId === item.id}
                  onContextMenu={(event) => openWorkstreamMenu(event, item.id, item.title, onMenu)}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
                      openWorkstreamMenu(event, item.id, item.title, onMenu)
                  }}
                  style={{
                    ...workstreamColorStyle(item.color),
                    left: point.x,
                    top: point.y,
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                  }}
                >
                  <button type="button" className="sky-workstreams-card-open" onClick={() => select(item.id)}>
                    <strong title={item.title}>{item.title}</strong>
                    <span className="sky-workstreams-card-outcome" title={item.outcome}>
                      {item.outcome || 'The outcome is taking shape.'}
                    </span>
                    <span className="sky-workstreams-card-bottom">
                      <span className="sky-workstreams-card-summary">
                        {item.parentId && 'Sub-workstream · '}
                        {summary}
                      </span>
                      {item.status === 'active' && (
                        <span
                          className="sky-workstreams-card-assistance"
                          data-assisting={item.assistance !== 'off' && item.assistance !== 'manual'}
                        >
                          {item.assistance === 'off' || item.assistance === 'manual'
                            ? 'You’re leading'
                            : item.assistance === 'drive'
                              ? 'Sky driving'
                              : 'Sky assisting'}
                        </span>
                      )}
                    </span>
                  </button>
                  <WorkstreamMenuButton
                    workstreamId={item.id}
                    title={item.title}
                    onMenu={onMenu}
                    disabled={disabled}
                    className="sky-workstreams-canvas-menu"
                    style={{ transform: `scale(${1 / camera.zoom})` }}
                  />
                  {connector(item)}
                </div>
              )
            })}
          </>
        ) : (
          <>
            {weeks.map((index) => {
              const week = monday.addDays(index * 7)
              return (
                <div
                  key={index}
                  className="sky-workstreams-week"
                  style={{ left: LABEL_WIDTH + index * WEEK_WIDTH, width: WEEK_WIDTH, height: totalHeight }}
                >
                  <strong>W{week.weekOfYear}</strong>
                  <span>
                    {week.ymd} — {week.addDays(6).ymd}
                  </span>
                </div>
              )
            })}
            <div
              className="sky-workstreams-today-line"
              style={{ left: LABEL_WIDTH + (dayOffset(monday.ymd, today) * WEEK_WIDTH) / 7, height: totalHeight }}
            >
              <span>Today</span>
            </div>
            <div className="sky-workstreams-label-column" style={{ left: laneLeft, height: totalHeight }}>
              <span>Workstreams</span>
            </div>
            {items.map((item) => {
              const lane = lanes.get(item.id)!
              return (
                <div
                  key={item.id}
                  className="sky-workstreams-lane"
                  data-workstream={item.id}
                  data-color={item.color ?? 'blue'}
                  data-muted={!!neighborhood && !neighborhood.has(item.id)}
                  data-drop-target={linkDrag?.toId === item.id}
                  onContextMenu={(event) => openWorkstreamMenu(event, item.id, item.title, onMenu)}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
                      openWorkstreamMenu(event, item.id, item.title, onMenu)
                  }}
                  data-dragging={laneDrag?.id === item.id}
                  style={{
                    ...workstreamColorStyle(item.color),
                    top: lane.y + (laneDrag?.id === item.id ? laneDrag.delta : 0),
                    height: lane.height,
                  }}
                >
                  <div
                    className="sky-workstreams-lane-label"
                    data-workstream={item.id}
                    data-lane-drag
                    data-selected={selected === item.id}
                    title="Drag vertically to reorder. Hold Space to pan."
                    style={{ left: laneLeft }}
                  >
                    <button type="button" className="sky-workstreams-lane-open" onClick={() => select(item.id)}>
                      <strong>{item.title}</strong>
                      <span>
                        {item.status !== 'active' && `${item.status[0]!.toUpperCase()}${item.status.slice(1)} · `}
                        {item.activities.length
                          ? `${item.activities.length} ${item.activities.length === 1 ? 'activity' : 'activities'}`
                          : 'No activities yet'}
                      </span>
                    </button>
                    <WorkstreamMenuButton
                      workstreamId={item.id}
                      title={item.title}
                      onMenu={onMenu}
                      disabled={disabled}
                      className="sky-workstreams-canvas-menu"
                      style={{ transform: `scale(${1 / camera.zoom})` }}
                    />
                    {connector(item)}
                  </div>
                  {!item.activities.length && (
                    <button
                      type="button"
                      className="sky-workstreams-unscheduled"
                      style={{ left: laneLeft, top: 115 }}
                      data-workstream={item.id}
                      onClick={() => select(item.id)}
                    >
                      Define the next useful action →
                    </button>
                  )}
                  {item.activities.some((activity) => !activity.start) && (
                    <span className="sky-workstreams-undated-label" style={{ left: laneLeft + 4 }}>
                      Unscheduled
                    </span>
                  )}
                  {item.activities.map((activity) => {
                    const box = activityBox(item, activity)
                    const done = activity.status === 'done' || activity.status === 'decided'
                    return (
                      <button
                        key={activity.id}
                        type="button"
                        className="sky-workstreams-clip"
                        data-workstream={item.id}
                        data-activity={activity.id}
                        data-scheduled={!!activity.start}
                        data-kind={activity.kind}
                        data-done={done}
                        title={`${activity.title} · ${done ? 'Completed' : activity.kind === 'decision' ? 'Decision' : 'Action'}`}
                        onClick={() => select(item.id)}
                        style={{ left: box.x, width: box.width, top: box.y }}
                      >
                        <span>
                          {done ? '✓ ' : activity.kind === 'decision' ? '◇ ' : ''}
                          {activity.title}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {laneDrag && (
              <div
                className="sky-workstreams-lane-insertion"
                style={{
                  left: laneLeft,
                  top: laneDrag.beforeId
                    ? lanes.get(laneDrag.beforeId)!.y - 9
                    : Math.max(...[...lanes.values()].map((lane) => lane.y + lane.height)) + 9,
                  width: LABEL_WIDTH + WEEK_WIDTH * 4 - laneLeft,
                }}
              />
            )}
          </>
        )}
      </div>
      {linkDrag && (
        <div className="sky-workstreams-link-hint" role="status">
          {linkDrag.toId
            ? 'Release to choose how these workstreams relate'
            : 'Drop on another workstream · Esc to cancel'}
        </div>
      )}
      {!items.length && (
        <WorkstreamsEmpty
          onStart={onAdd}
          disabled={disabled}
          hasWorkstreams={hasWorkstreams}
          onClearFilters={onClearFilters}
          availableHeight={size.y}
        />
      )}
      <div className="sky-workstreams-dock" data-canvas-control>
        <ActionIcon
          aria-label="Select tool (V)"
          title="Select (V)"
          variant={tool === 'select' ? 'light' : 'subtle'}
          onClick={() => setTool('select')}
        >
          ↖
        </ActionIcon>
        <ActionIcon
          aria-label="Hand tool (H)"
          title="Pan (H or hold Space)"
          variant={tool === 'hand' ? 'light' : 'subtle'}
          onClick={() => setTool('hand')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v6c0 4-2 6-6 6h-1c-3 0-4-2-5-4l-4-5a1.5 1.5 0 0 1 2-2l2 1Z" />
          </svg>
        </ActionIcon>
        <span className="sky-workstreams-dock-divider" />
        {view === 'map' && (
          <ActionIcon
            aria-label="Snap to workstreams"
            aria-pressed={snapping}
            title={`Snapping ${snapping ? 'on' : 'off'} · Hold Option / Alt to move freely`}
            variant={snapping ? 'light' : 'subtle'}
            onClick={() => {
              const next = !snapping
              setSnapping(next)
              try {
                localStorage.setItem('sky-workstreams-snapping', String(next))
              } catch {
                /* Snapping preferences are optional. */
              }
            }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M5 3v10a7 7 0 0 0 14 0V3h-4v10a3 3 0 0 1-6 0V3ZM5 7h4m6 0h4" />
            </svg>
          </ActionIcon>
        )}
        <ActionIcon
          aria-label="Zoom out (-)"
          disabled={camera.zoom <= 0.1}
          onClick={() => publish(zoomAt(cameraRef.current, cameraRef.current.zoom / 1.25, center))}
        >
          −
        </ActionIcon>
        <button
          type="button"
          className="sky-workstreams-zoom"
          title="Reset to 100% (Shift+0)"
          onClick={() => publish(zoomAt(cameraRef.current, 1, center))}
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <ActionIcon
          aria-label="Zoom in (+)"
          disabled={camera.zoom >= 8}
          onClick={() => publish(zoomAt(cameraRef.current, cameraRef.current.zoom * 1.25, center))}
        >
          ＋
        </ActionIcon>
        <Button size="xs" onClick={() => fit()} title="Fit all (Shift+1)">
          Fit
        </Button>
        <ActionIcon aria-label="Canvas controls" onClick={() => setHelp(!help)}>
          ?
        </ActionIcon>
      </div>
      {help && (
        <div className="sky-workstreams-help" data-canvas-control>
          <strong>Move around the work</strong>
          <p>Scroll to pan. Pinch or Ctrl / ⌘ + scroll to zoom.</p>
          <p>
            <kbd>＋</kbd> / <kbd>−</kbd> Zoom
            <br />
            <kbd>Space</kbd> + drag Pan
            <br />
            <kbd>Shift 0</kbd> Actual size
            <br />
            <kbd>Shift 1</kbd> Fit all
            <br />
            <kbd>Shift 2</kbd> Fit selection
          </p>
          <p>
            {view === 'map'
              ? 'Drag a card to align its edges, center, or spacing with nearby workstreams. The magnet turns snapping on or off.'
              : 'Drag a lane heading vertically to reorder workstreams. Drag a dated activity horizontally to change its planned dates.'}
          </p>
          {view === 'map' && (
            <p>
              <kbd>Option / Alt</kbd> Move freely
              <br />
              <kbd>Shift</kbd> Keep a drag straight
              <br />
              <kbd>Esc</kbd> Cancel a drag
            </p>
          )}
          <p>
            Drag a card’s link handle to another workstream to relate them. Select a line to understand or edit the
            relationship. On touch, use the workstream’s three-dot menu.
          </p>
        </div>
      )}
    </div>
  )
}
