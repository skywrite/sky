---
created: 2026-10-27
updated: 2026-10-27
---

# Canvas

A pannable, zoomable stage for the web client.
The workstreams map and timeline are built on it; an org chart or any other spatial view can be too.

## Pieces

- `useCanvas(options)` owns the camera, the select/hand tool, the stage size, and every gesture:
  drag to pan, wheel and pinch to pan or zoom, Space to pan, `+`/`-`, Shift+0/1/2, H and V.
  It remembers the camera in localStorage under `options.persistKey`; changing the key switches cameras,
  which is how the workstreams map and timeline keep separate views.
- `Canvas` renders the stage and the world.
  Children are drawn in world coordinates and move with the camera; `overlay` is drawn over the stage in screen
  coordinates, for toolbars, hints and empty states.
  Any other prop lands on the stage element, so the caller sets its label, data attributes and context menu.
- `CanvasToolbar` is the dock: tools, zoom, Fit, an optional snapping toggle, and a `?` that opens `help`.
- `camera.ts` is the camera math, `snap.ts` snaps a dragged rectangle to its neighbors, and `SnapGuides` draws
  the alignment and spacing guides that `snap.ts` reports.

## Dragging things

The hook knows nothing about what is on the canvas.
A press on an item reaches the caller through `options.drag`:

- `start(event, context)` runs when the pointer goes down in the world and the person is not panning.
  Return `'pan'` for empty space, `'none'` to ignore the press, or a `DragSession`.
- `control(event, context)` runs instead when the press lands on a control (`data-canvas-control`) inside the
  world, such as a link handle. A session returned here is `immediate`: it captures the pointer at once.
- A `DragSession` gets `move` and `end` in stage pixels, with the delta from where the pointer went down, and
  `cancel` on Escape, a second finger, a lost window, or a view change.
  `end` says whether the pointer moved, so a tap can select instead of drag.
  `refresh` runs when Alt or Shift changes or the camera moves under a drag, so the session can recompute from
  its last pointer position.

`context.camera` is the camera when the press began and `context.current()` is the live one; a drag that
converts pointer positions to world coordinates needs the live one after a wheel or a zoom.

## Chrome

Mark toolbars, menus and handles with `data-canvas-control`.
A press on one never pans, and keyboard shortcuts stay quiet while one has focus.
The world element carries `data-canvas-world`: wheel events over controls inside it still scroll the canvas;
over controls outside it, such as the dock, they do not.

Clicks that follow a drag are suppressed; a click handler on an item asks `canvas.canClick()` first.

`WorkstreamsCanvas` in `web/client/workstreams/` is the reference use: four kinds of drag (cards, lanes,
scheduled activities, link handles), a reveal camera on selection, and page-specific stage attributes.
