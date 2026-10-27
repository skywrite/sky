/** Display order is independent of dates, work state, and Map coordinates. */
export function moveLaneBefore(ids: readonly string[], id: string, beforeId: string | null): string[] {
  if (!ids.includes(id) || beforeId === id || (beforeId !== null && !ids.includes(beforeId))) return [...ids]
  const remaining = ids.filter((value) => value !== id)
  remaining.splice(beforeId === null ? remaining.length : remaining.indexOf(beforeId), 0, id)
  return remaining
}

/** Change only the moved lane's rank when there is space between its neighbors. */
export function laneOrderChanges(
  ids: readonly string[],
  id: string,
  beforeId: string | null,
  ranks: Record<string, number>,
): Record<string, number> {
  const next = moveLaneBefore(ids, id, beforeId)
  if (next.every((value, index) => value === ids[index])) return {}
  const index = next.indexOf(id)
  const previous = index > 0 ? ranks[next[index - 1]!] : undefined
  const following = index + 1 < next.length ? ranks[next[index + 1]!] : undefined
  const rank =
    previous === undefined
      ? (following ?? 0) - 1
      : following === undefined
        ? previous + 1
        : previous + (following - previous) / 2
  if (
    Number.isFinite(rank) &&
    (previous === undefined || rank > previous) &&
    (following === undefined || rank < following)
  )
    return { [id]: rank }
  // Hand-edited equal ranks or exhausted floating-point gaps need a small rebalance.
  return Object.fromEntries(next.map((value, offset) => [value, offset]))
}

export type LaneGeometry = { id: string; y: number; height: number }

/** Delta is in canvas units, so a drag has the same meaning at every zoom. */
export function laneBeforeAt(lanes: readonly LaneGeometry[], id: string, deltaY: number): string | null {
  const moved = lanes.find((lane) => lane.id === id)
  if (!moved) return null
  const center = moved.y + moved.height / 2 + deltaY
  return lanes.find((lane) => lane.id !== id && center < lane.y + lane.height / 2)?.id ?? null
}
