import { assert, test } from '#test'
import { snapWorkstream, type SnapRect, type SnapResult } from './workstreamsSnap.ts'

const rect = (id: string, x: number, y: number, width = 100, height = 80): SnapRect => ({ id, x, y, width, height })

test({ name: 'workstream snapping - tolerance follows screen pixels without large jumps at low zoom' }, () => {
  const peer = rect('anchor', 100, 0)
  assert({
    given: 'drags five or seven screen pixels away from an aligned edge at several zooms',
    should: 'snap within six screen pixels and leave the farther position untouched',
    actual: [0.5, 1, 2, 4].map((zoom) =>
      [5, 7].map((offset) => snapWorkstream(rect('moving', 100 + offset / zoom, 200), [peer], zoom).point.x),
    ),
    expected: [
      [100, 114],
      [100, 107],
      [100, 103.5],
      [100, 101.75],
    ],
  })
  assert({
    given: 'a very far zoom-out',
    should: 'cap the attraction distance in world space',
    actual: snapWorkstream(rect('moving', 125, 200), [peer], 0.01).point.x,
    expected: 125,
  })
})

test({ name: 'workstream snapping - card edges and centers align independently of card dimensions' }, () => {
  const peer = rect('anchor', 100, 0)
  assert({
    given: 'a wider card near a matching left edge and a matching center',
    should: 'align the appropriate anchor rather than assume equal widths',
    actual: [103, 78].map((x) => snapWorkstream(rect('moving', x, 180, 140), [peer], 1)),
    expected: [
      { point: { x: 100, y: 180 }, guides: [{ axis: 'x', value: 100, from: 0, to: 260 }], gaps: [] },
      { point: { x: 80, y: 180 }, guides: [{ axis: 'x', value: 150, from: 0, to: 260 }], gaps: [] },
    ],
  })
  assert({
    given: 'the left edge of one card near the right edge of another',
    should: 'also support alignment between different anchors',
    actual: snapWorkstream(rect('moving', 197, 180), [peer], 1),
    expected: { point: { x: 200, y: 180 }, guides: [{ axis: 'x', value: 200, from: 0, to: 260 }], gaps: [] },
  })
})

test({ name: 'workstream snapping - equal spacing works before, between, and after nearby cards' }, () => {
  const peers = [rect('first', 0, 0), rect('second', 150, 0)]
  assert({
    given: 'two cards with a fifty-unit horizontal gap',
    should: 'extend that spacing in either direction and measure both actual gaps',
    actual: [-153, 304].map((x) => {
      const result = snapWorkstream(rect('moving', x, 0), peers, 1)
      return { x: result.point.x, gaps: result.gaps }
    }),
    expected: [
      {
        x: -150,
        gaps: [
          { from: { x: -50, y: 40 }, to: { x: 0, y: 40 }, distance: 50 },
          { from: { x: 100, y: 40 }, to: { x: 150, y: 40 }, distance: 50 },
        ],
      },
      {
        x: 300,
        gaps: [
          { from: { x: 100, y: 40 }, to: { x: 150, y: 40 }, distance: 50 },
          { from: { x: 250, y: 40 }, to: { x: 300, y: 40 }, distance: 50 },
        ],
      },
    ],
  })
  const between = snapWorkstream(rect('moving', 204, 0), [rect('first', 0, 0), rect('second', 400, 0)], 1)
  assert({
    given: 'a card being placed between two others',
    should: 'balance the available space on either side',
    actual: { point: between.point, gaps: between.gaps },
    expected: {
      point: { x: 200, y: 0 },
      gaps: [
        { from: { x: 100, y: 40 }, to: { x: 200, y: 40 }, distance: 100 },
        { from: { x: 300, y: 40 }, to: { x: 400, y: 40 }, distance: 100 },
      ],
    },
  })
})

test({ name: 'workstream snapping - vertical spacing uses card heights and a shared column' }, () => {
  const result = snapWorkstream(rect('moving', -100, 263), [rect('first', -100, 0), rect('second', -100, 130)], 1)
  assert({
    given: 'a column with a fifty-unit vertical gap',
    should: 'snap and measure the two vertical spaces',
    actual: { point: result.point, gaps: result.gaps },
    expected: {
      point: { x: -100, y: 260 },
      gaps: [
        { from: { x: -50, y: 80 }, to: { x: -50, y: 130 }, distance: 50 },
        { from: { x: -50, y: 210 }, to: { x: -50, y: 260 }, distance: 50 },
      ],
    },
  })
})

test({ name: 'workstream snapping - spacing does not use unrelated rows, enormous gaps, or occupied spaces' }, () => {
  assert({
    given: 'cards outside the moving row, separated by an enormous gap, or already occupying the target',
    should: 'leave the drag untouched with no spacing guides',
    actual: [
      snapWorkstream(rect('moving', 304, 200), [rect('first', 0, 0), rect('second', 150, 0)], 1),
      snapWorkstream(rect('moving', 1404, 0), [rect('first', 0, 0), rect('second', 700, 0)], 1),
      snapWorkstream(
        rect('moving', 304, 0),
        [rect('first', 0, 0), rect('second', 150, 0), rect('occupied', 280, 0)],
        1,
      ),
    ].map((result) => ({ x: result.point.x, gaps: result.gaps })),
    expected: [
      { x: 304, gaps: [] },
      { x: 1404, gaps: [] },
      { x: 304, gaps: [] },
    ],
  })
})

test({ name: 'workstream snapping - modifier keys preserve raw coordinates on disabled axes' }, () => {
  const moving = rect('moving', 103, 3)
  const peers = [rect('anchor', 100, 0)]
  assert({
    given: 'a drag near both axes with a constrained or disabled snap',
    should: 'only move the permitted axis and omit all guides when disabled',
    actual: [
      snapWorkstream(moving, peers, 1, { axis: 'x' }),
      snapWorkstream(moving, peers, 1, { axis: 'y' }),
      snapWorkstream(moving, peers, 1, { disabled: true }),
    ].map((result) => ({ point: result.point, axes: result.guides.map((guide) => guide.axis), gaps: result.gaps })),
    expected: [
      { point: { x: 100, y: 3 }, axes: ['x'], gaps: [] },
      { point: { x: 103, y: 0 }, axes: ['y'], gaps: [] },
      { point: { x: 103, y: 3 }, axes: [], gaps: [] },
    ],
  })
})

test({ name: 'workstream snapping - negative coordinates, peer order, and self references are safe' }, () => {
  const moving = rect('moving', -98, -200)
  const peers = [rect('alpha', -100, -400), rect('beta', -96, 0), moving]
  const result = snapWorkstream(moving, peers, 1, { axis: 'x' })
  assert({
    given: 'equally close targets and the dragged card itself in the peer list',
    should: 'choose a stable target regardless of peer enumeration or zoom sign',
    actual: [
      result,
      snapWorkstream(moving, [...peers].reverse(), 1, { axis: 'x' }),
      snapWorkstream(moving, peers, -1, { axis: 'x' }),
    ],
    expected: Array.from(
      { length: 3 },
      (): SnapResult => ({
        point: { x: -100, y: -200 },
        guides: [{ axis: 'x', value: -50, from: -400, to: -120 }],
        gaps: [],
      }),
    ),
  })
  assert({
    given: 'only a self-reference or an aligned peer far outside the relevant area',
    should: 'avoid stray guides',
    actual: [[moving], [rect('distant', -100, 10000)]].map((items) => snapWorkstream(moving, items, 1)),
    expected: Array.from({ length: 2 }, (): SnapResult => ({ point: { x: -98, y: -200 }, guides: [], gaps: [] })),
  })
})

test({ name: 'workstream snapping - orthogonal alignment cannot leave false equal-spacing guides' }, () => {
  const moving = rect('moving', 304, 79)
  const result = snapWorkstream(moving, [rect('first', 0, 0), rect('second', 150, 0)], 1)
  assert({
    given: 'a card just overlapping a row that snaps to the row’s lower edge',
    should: 'drop the horizontal spacing snap when the final card is no longer in that row',
    actual: result,
    expected: { point: { x: 304, y: 80 }, guides: [{ axis: 'y', value: 80, from: 150, to: 404 }], gaps: [] },
  })
})
