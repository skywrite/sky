export const CARD_WIDTH = 480
export const CARD_HEIGHT = 104
const COLUMN_GAP = 80
const ROW_GAP = 75
const CLEARANCE = 40

export type WorkstreamPosition = { x: number; y: number }

export function defaultWorkstreamPosition(index: number): WorkstreamPosition {
  return { x: (index % 3) * (CARD_WIDTH + COLUMN_GAP), y: Math.floor(index / 3) * (CARD_HEIGHT + ROW_GAP) }
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

/** Keep new work near the arranged group, without treating its distance from the origin as empty space. */
export function nextWorkstreamPosition(
  occupied: readonly WorkstreamPosition[],
  preferred: readonly WorkstreamPosition[] = occupied,
): WorkstreamPosition {
  if (!occupied.length) return { x: 0, y: 0 }
  const anchors = preferred.length ? preferred : occupied
  const center = { x: median(anchors.map((point) => point.x)), y: median(anchors.map((point) => point.y)) }
  const dx = CARD_WIDTH + COLUMN_GAP
  const dy = CARD_HEIGHT + ROW_GAP
  const candidates = occupied.flatMap((point) => [
    { x: point.x + dx, y: point.y },
    { x: point.x, y: point.y + dy },
    { x: point.x - dx, y: point.y },
    { x: point.x, y: point.y - dy },
  ])
  const score = (point: WorkstreamPosition) => ((point.x - center.x) / dx) ** 2 + ((point.y - center.y) / dy) ** 2
  return candidates
    .filter((candidate) =>
      occupied.every(
        (point) =>
          candidate.x >= point.x + CARD_WIDTH + CLEARANCE ||
          candidate.x + CARD_WIDTH + CLEARANCE <= point.x ||
          candidate.y >= point.y + CARD_HEIGHT + CLEARANCE ||
          candidate.y + CARD_HEIGHT + CLEARANCE <= point.y,
      ),
    )
    .sort((a, b) => score(a) - score(b))[0]!
}
