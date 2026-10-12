import type { Bounds, Point } from './workstreamsCamera.ts'

export type SnapRect = Bounds & { id: string }
export interface AlignmentGuide {
  axis: 'x' | 'y'
  value: number
  from: number
  to: number
}
export interface SpacingGuide {
  from: Point
  to: Point
  distance: number
}
export interface SnapResult {
  point: Point
  guides: AlignmentGuide[]
  gaps: SpacingGuide[]
}

type Axis = 'x' | 'y'
type Spacing = { first: SnapRect; second: SnapRect; placement: 'before' | 'between' | 'after' }
interface Candidate {
  value: number
  distance: number
  proximity: number
  priority: number
  key: string
  alignment?: { peer: SnapRect; offset: number }
  spacing?: Spacing
}

const EPSILON = 0.000001
const otherAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')
const size = (rect: Bounds, axis: Axis) => (axis === 'x' ? rect.width : rect.height)
const end = (rect: Bounds, axis: Axis) => rect[axis] + size(rect, axis)
const center = (rect: Bounds, axis: Axis) => rect[axis] + size(rect, axis) / 2
const compareKeys = (first: string, second: string) => (first < second ? -1 : first > second ? 1 : 0)

function overlap(rects: readonly Bounds[], axis: Axis): { start: number; end: number } {
  return {
    start: Math.max(...rects.map((rect) => rect[axis])),
    end: Math.min(...rects.map((rect) => end(rect, axis))),
  }
}

function spacingGuides(moving: SnapRect, spacing: Spacing, axis: Axis): SpacingGuide[] {
  const { first, second, placement } = spacing
  const rects =
    placement === 'before'
      ? [moving, first, second]
      : placement === 'after'
        ? [first, second, moving]
        : [first, moving, second]
  const shared = overlap(rects, otherAxis(axis))
  if (shared.end <= shared.start) return []
  const firstGap = rects[1]![axis] - end(rects[0]!, axis)
  const secondGap = rects[2]![axis] - end(rects[1]!, axis)
  if (firstGap <= 0 || Math.abs(firstGap - secondGap) > EPSILON) return []
  const cross = (shared.start + shared.end) / 2
  return [0, 1].map((index) => {
    const from = end(rects[index]!, axis)
    const to = rects[index + 1]![axis]
    return {
      from: axis === 'x' ? { x: from, y: cross } : { x: cross, y: from },
      to: axis === 'x' ? { x: to, y: cross } : { x: cross, y: to },
      distance: to - from,
    }
  })
}

function candidates(
  moving: SnapRect,
  peers: readonly SnapRect[],
  axis: Axis,
  threshold: number,
  reach: number,
): Candidate[] {
  const other = otherAxis(axis)
  const results: Candidate[] = []
  const nearby = peers.filter(
    (peer) => Math.max(peer[other] - end(moving, other), moving[other] - end(peer, other), 0) <= reach,
  )
  const add = (candidate: Omit<Candidate, 'distance'>) => {
    const distance = Math.abs(candidate.value - moving[axis])
    if (distance <= threshold + EPSILON) results.push({ ...candidate, distance })
  }

  for (const peer of nearby) {
    const offsets = [0, size(moving, axis) / 2, size(moving, axis)]
    const anchors = [peer[axis], center(peer, axis), end(peer, axis)]
    for (const [ownIndex, offset] of offsets.entries()) {
      for (const [peerIndex, anchor] of anchors.entries()) {
        add({
          value: anchor - offset,
          proximity: Math.abs(center(peer, other) - center(moving, other)),
          priority: ownIndex === peerIndex ? (ownIndex === 1 ? 0 : 1) : 2,
          key: `${peer.id}:${ownIndex}:${peerIndex}`,
          alignment: { peer, offset },
        })
      }
    }
  }

  const row = nearby
    .filter((peer) => {
      const shared = overlap([moving, peer], other)
      return shared.end > shared.start
    })
    .sort((first, second) => first[axis] - second[axis] || compareKeys(first.id, second.id))
  const maxGap = Math.max(240, size(moving, axis))
  for (let index = 0; index + 1 < row.length; index++) {
    const first = row[index]!
    const second = row[index + 1]!
    const shared = overlap([moving, first, second], other)
    if (shared.end <= shared.start) continue
    const existingGap = second[axis] - end(first, axis)
    if (existingGap <= 0) continue

    const addSpacing = (value: number, placement: Spacing['placement'], gap: number) => {
      if (gap <= 0 || gap > maxGap) return
      const placed = { ...moving, [axis]: value }
      if (
        row.some((peer) => {
          const sharedAlong = overlap([placed, peer], axis)
          return sharedAlong.end > sharedAlong.start + EPSILON
        })
      )
        return
      add({
        value,
        proximity: Math.min(
          Math.abs(center(first, axis) - center(placed, axis)),
          Math.abs(center(second, axis) - center(placed, axis)),
        ),
        priority: 3,
        key: `${first.id}:${second.id}:${placement}`,
        spacing: { first, second, placement },
      })
    }

    addSpacing(first[axis] - size(moving, axis) - existingGap, 'before', existingGap)
    const betweenGap = (existingGap - size(moving, axis)) / 2
    addSpacing(end(first, axis) + betweenGap, 'between', betweenGap)
    addSpacing(end(second, axis) + existingGap, 'after', existingGap)
  }

  return results.sort(
    (first, second) =>
      first.distance - second.distance ||
      first.priority - second.priority ||
      first.proximity - second.proximity ||
      compareKeys(first.key, second.key),
  )
}

/** Snap in screen space, with a world-space cap so a far zoom-out never pulls a card across its neighbors. */
export function snapWorkstream(
  moving: SnapRect,
  peers: readonly SnapRect[],
  zoom: number,
  options: { disabled?: boolean; axis?: Axis } = {},
): SnapResult {
  const point: Point = { x: moving.x, y: moving.y }
  if (options.disabled) return { point, guides: [], gaps: [] }
  const scale = Number.isFinite(zoom) && zoom !== 0 ? Math.abs(zoom) : 1
  const threshold = Math.min(24, 6 / scale)
  const reach = Math.min(1200, 640 / scale)
  const others = peers.filter((peer) => peer.id !== moving.id)
  const chosen: Partial<Record<Axis, Candidate>> = {}
  for (const axis of ['x', 'y'] as const) {
    if (options.axis && options.axis !== axis) continue
    const candidate = candidates(moving, others, axis, threshold, reach)[0]
    if (!candidate) continue
    chosen[axis] = candidate
    point[axis] = candidate.value
  }

  // An orthogonal snap can move a card out of the row that justified equal spacing.
  // Drop that snap rather than show measurements that no longer describe the cards.
  for (let pass = 0; pass < 2; pass++) {
    for (const axis of ['x', 'y'] as const) {
      const candidate = chosen[axis]
      if (candidate?.spacing && !spacingGuides({ ...moving, ...point }, candidate.spacing, axis).length) {
        point[axis] = moving[axis]
        delete chosen[axis]
      }
    }
  }

  const guides: AlignmentGuide[] = []
  const gaps: SpacingGuide[] = []
  const placed = { ...moving, ...point }
  for (const axis of ['x', 'y'] as const) {
    const candidate = chosen[axis]
    if (candidate?.alignment) {
      const other = otherAxis(axis)
      guides.push({
        axis,
        value: point[axis] + candidate.alignment.offset,
        from: Math.min(placed[other], candidate.alignment.peer[other]),
        to: Math.max(end(placed, other), end(candidate.alignment.peer, other)),
      })
    }
    if (candidate?.spacing) gaps.push(...spacingGuides(placed, candidate.spacing, axis))
  }
  return { point, guides, gaps }
}
