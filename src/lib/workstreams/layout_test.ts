import { assert, test } from '#test'
import { CARD_HEIGHT, CARD_WIDTH, nextWorkstreamPosition } from './layout.ts'

test('new work follows a moved group rather than the origin or a distant outlier', () => {
  const group = [
    { x: -8000, y: 5000 },
    { x: -7440, y: 5000 },
    { x: -8000, y: 5179 },
  ]
  const occupied = [...group, { x: 40000, y: -30000 }]
  const position = nextWorkstreamPosition(occupied)
  assert({
    given: 'three arranged cards far from the origin and one distant outlier',
    should: 'stay aligned beside the nearby group without overlapping any existing card',
    actual: [
      group.some(
        (point) =>
          (position.x === point.x && Math.abs(position.y - point.y) === CARD_HEIGHT + 75) ||
          (position.y === point.y && Math.abs(position.x - point.x) === CARD_WIDTH + 80),
      ),
      occupied.every(
        (point) => Math.abs(point.x - position.x) >= CARD_WIDTH || Math.abs(point.y - position.y) >= CARD_HEIGHT,
      ),
    ],
    expected: [true, true],
  })
})

test('new work finds free space around a densely arranged group', () => {
  const occupied = Array.from({ length: 25 }, (_, index) => ({ x: (index % 5) * 500, y: Math.floor(index / 5) * 120 }))
  const before = JSON.stringify(occupied)
  const position = nextWorkstreamPosition(occupied)
  assert({
    given: 'a group with less clearance between its cards than new placements use',
    should: 'find an outside neighbor with clearance without moving existing cards',
    actual: [
      occupied.every(
        (point) =>
          Math.abs(point.x - position.x) >= CARD_WIDTH + 40 || Math.abs(point.y - position.y) >= CARD_HEIGHT + 40,
      ),
      JSON.stringify(occupied) === before,
      position.x >= -560 && position.x <= 2560 && position.y >= -179 && position.y <= 659,
    ],
    expected: [true, true, true],
  })
})

test('a child stays near its parent while still avoiding the other work', () => {
  const parent = { x: 9000, y: -4000 }
  const group = [{ x: 0, y: 0 }, { x: 560, y: 0 }, { x: 0, y: 179 }, parent]
  assert({
    given: 'a parent separated from the general group',
    should: 'put its child in the adjacent free slot',
    actual: nextWorkstreamPosition(group, [parent]),
    expected: { x: 9560, y: -4000 },
  })
})

test('the first workstream starts at the origin', () => {
  assert({
    given: 'no existing work',
    should: 'start a new group',
    actual: nextWorkstreamPosition([]),
    expected: { x: 0, y: 0 },
  })
})
