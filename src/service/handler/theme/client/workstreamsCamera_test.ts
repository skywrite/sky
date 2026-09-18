import { assert, test } from '#test'
import {
  dragPoint,
  fitCamera,
  overviewCamera,
  pinchCamera,
  readCamera,
  revealCamera,
  wheelCamera,
  worldAt,
  zoomAt,
} from './workstreamsCamera.ts'

test({ name: 'workstream camera - zoom keeps the world beneath the cursor stable' }, () => {
  const camera = { x: -340, y: 120, zoom: 0.5 }
  const cursor = { x: 580, y: 290 }
  assert({
    given: 'a panned and zoomed canvas',
    should: 'keep the cursor anchored when zooming and at the zoom limit',
    actual: [2, 100, 0.01].map((zoom) => worldAt(zoomAt(camera, zoom, cursor), cursor)),
    expected: [worldAt(camera, cursor), worldAt(camera, cursor), worldAt(camera, cursor)],
  })
})

test('opening work reveals its complete card despite old pan and zoom preferences', () => {
  const bounds = { x: -560, y: 700, width: 480, height: 104 }
  const viewport = { x: 650, y: 500 }
  const cameras = [
    { x: -12000, y: 9000, zoom: 8 },
    { x: 3000, y: -8000, zoom: 0.1 },
  ]
  const revealed = cameras.map((camera) => revealCamera(camera, bounds, viewport))
  assert({
    given: 'a new or opened card outside a saved viewport at either zoom extreme',
    should: 'show the entire card at a readable scale inside the current canvas',
    actual: revealed.map((camera) => {
      const x = camera.x + bounds.x * camera.zoom
      const y = camera.y + bounds.y * camera.zoom
      return (
        x >= 32 &&
        y >= 32 &&
        x + bounds.width * camera.zoom <= viewport.x - 32 &&
        y + bounds.height * camera.zoom <= viewport.y - 32 &&
        camera.zoom >= 1
      )
    }),
    expected: [true, true],
  })
  const visible = { x: 60, y: 100, zoom: 1 }
  assert({
    given: 'an already visible card at a useful zoom',
    should: 'preserve the existing camera exactly',
    actual: revealCamera(visible, { x: 0, y: 0, width: 480, height: 104 }, viewport) === visible,
    expected: true,
  })
})

test('entering an empty overview reveals existing work without changing its saved position', () => {
  const content = [{ x: -840, y: -480, width: 480, height: 104 }]
  const viewport = { x: 1000, y: 600 }
  const recovered = overviewCamera({ x: -12000, y: 9000, zoom: 1 }, content, viewport)
  assert({
    given: 'an offscreen camera and a workstream above and left of the canvas origin',
    should: 'center the existing card at its normal readable scale',
    actual: { center: worldAt(recovered, { x: 500, y: 300 }), zoom: recovered.zoom },
    expected: { center: { x: -600, y: -428 }, zoom: 1 },
  })
  const visible = { x: 600, y: 500, zoom: 0.5 }
  assert({
    given: 'a saved overview that already shows work',
    should: 'retain the exact camera rather than fit everything again',
    actual: overviewCamera(visible, content, viewport) === visible,
    expected: true,
  })
})

test('overview recovery uses actual work instead of the empty space between distant cards', () => {
  const content = [
    { x: -60000, y: 0, width: 480, height: 104 },
    { x: 60000, y: 0, width: 480, height: 104 },
  ]
  const recovered = overviewCamera({ x: 48, y: 68, zoom: 1 }, content, { x: 1000, y: 600 })
  assert({
    given: 'two cards straddling the viewport even at the minimum zoom',
    should: 'reveal a real card instead of fitting their empty midpoint',
    actual: content.some((item) => {
      const left = recovered.x + item.x * recovered.zoom
      const top = recovered.y + item.y * recovered.zoom
      return (
        left >= 0 && top >= 0 && left + item.width * recovered.zoom <= 1000 && top + item.height * recovered.zoom <= 600
      )
    }),
    expected: true,
  })
})

test('overview recovery waits for content and usable viewport dimensions', () => {
  const camera = { x: -12000, y: 9000, zoom: 1 }
  assert({
    given: 'no loaded work or a canvas that has not been measured',
    should: 'leave the camera alone until recovery has enough information',
    actual: [
      overviewCamera(camera, [], { x: 1000, y: 600 }) === camera,
      overviewCamera(camera, [{ x: 0, y: 0, width: 480, height: 104 }], { x: 0, y: 0 }) === camera,
    ],
    expected: [true, true],
  })
})

test({ name: 'workstream camera - dragging an object is independent of camera zoom' }, () => {
  assert({
    given: 'a 100 screen-pixel drag at 25% zoom',
    should: 'move the object 400 canvas units without modifying the camera',
    actual: dragPoint({ x: -50, y: 40 }, { x: 100, y: -25 }, 0.25),
    expected: { x: 350, y: -60 },
  })
})

test({ name: 'workstream camera - moving a pinch pans and zooms around the fingers' }, () => {
  const camera = { x: 40, y: 70, zoom: 1 }
  const anchor = worldAt(camera, { x: 200, y: 200 })
  const center = { x: 310, y: 260 }
  assert({
    given: 'a pinch whose center and spread both change',
    should: 'keep the original world anchor under the new center',
    actual: worldAt(pinchCamera(camera, anchor, center, 1.5), center),
    expected: anchor,
  })
})

test({ name: 'workstream camera - scroll pans without changing records or scale' }, () => {
  const camera = { x: 40, y: 70, zoom: 0.5 }
  assert({
    given: 'ordinary and shift scrolling',
    should: 'move the viewport with horizontal shift scrolling',
    actual: [false, true].map((shift) => wheelCamera(camera, { x: 0, y: 0 }, { x: 12, y: 40, zoom: false, shift })),
    expected: [
      { x: 28, y: 30, zoom: 0.5 },
      { x: -12, y: 70, zoom: 0.5 },
    ],
  })
})

test({ name: 'workstream camera - fitting negative coordinates and damaged preferences remains usable' }, () => {
  const bounds = { x: -500, y: -300, width: 400, height: 200 }
  const camera = fitCamera(bounds, { x: 600, y: 400 }, 50)
  assert({
    given: 'work entirely above and left of the origin',
    should: 'center its bounds in the viewport',
    actual: worldAt(camera, { x: 300, y: 200 }),
    expected: { x: -300, y: -200 },
  })
  assert({
    given: 'invalid saved cameras',
    should: 'restore a visible default',
    actual: [null, { x: 0, y: 0, zoom: 0 }, { x: NaN, y: 0, zoom: 1 }].map((value) => readCamera(value)),
    expected: Array.from({ length: 3 }, () => ({ x: 48, y: 68, zoom: 1 })),
  })
})
