import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import {
  type Bounds,
  type Camera,
  type Point,
  fitCamera,
  pinchCamera,
  readCamera,
  wheelCamera,
  worldAt,
  zoomAt,
} from './camera.ts'

export type CanvasTool = 'select' | 'hand'

/** What a drag can see when the pointer goes down. */
export interface GestureContext {
  /** Where the pointer went down, in stage pixels. */
  point: Point
  /** The same spot in world coordinates. */
  world: Point
  /** The camera when the pointer went down. */
  camera: Camera
  /** The middle button, Space, or the hand tool: the person wants to pan. */
  wantsPan: boolean
  element: HTMLDivElement
  /** The camera right now, including frames not yet drawn. */
  current(): Camera
  /** Stage pixels for a client position. */
  local(position: { clientX: number; clientY: number }): Point
}

/** A drag of something in the world, from the pointer going down until it is released. */
export interface DragSession {
  /** Capture the pointer at once, as a handle does. Otherwise the drag begins once the pointer moves 3px. */
  immediate?: boolean
  move(point: Point, delta: Point, event: PointerEvent): void
  /** `moved` is false for a press without a drag, such as a touch tap. */
  end(point: Point, delta: Point, moved: boolean, event: PointerEvent): void
  /** Escape, a second finger, a lost window, or a new persist key: undo what the drag showed. */
  cancel(): void
  /** A modifier key changed, or the camera moved under the pointer: recompute from the last pointer position. */
  refresh?(modifiers?: { altKey: boolean; shiftKey: boolean }): void
}
export type DragStart = DragSession | 'pan' | 'none'
export interface DragHandler {
  /**
   * The pointer went down on a control (`data-canvas-control`) inside the world, such as a handle on an item.
   * 'pan' lets the person pan through it. The default is 'none': controls are not dragged.
   */
  control?(event: PointerEvent, context: GestureContext): DragStart
  /** The pointer went down in the world and the person does not want to pan. Return 'pan' for empty space. */
  start(event: PointerEvent, context: GestureContext): DragStart
}

export interface CanvasOptions {
  /** The localStorage key that remembers the camera. Changing it switches to that key's camera. */
  persistKey?: string
  drag?: DragHandler
  /** The content to fit: everything, or the selection (Shift+2), null when there is none. */
  bounds?: (selection: boolean) => Bounds | null
}

type Gesture = { pointer: number; start: Point; camera: Camera; moved: boolean; session: DragSession | null }
type Pinch = { camera: Camera; anchor: Point; distance: number }
type SafariGesture = Event & { clientX: number; clientY: number; scale: number }

function load(key: string | undefined): Camera {
  try {
    return readCamera(key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null)
  } catch {
    return readCamera(null)
  }
}
function save(key: string | undefined, camera: Camera): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(camera))
  } catch {
    /* Camera preferences are optional. */
  }
}

/**
 * A pannable, zoomable stage. The hook owns the camera, the select/hand tool, pointer, wheel, pinch and keyboard
 * gestures, and hands drags of items to the `drag` handler. Render it with `Canvas`.
 */
export function useCanvas({ persistKey, drag, bounds }: CanvasOptions) {
  const stage = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState(() => load(persistKey))
  const cameraRef = useRef(camera)
  const keyRef = useRef(persistKey)
  const frame = useRef<number | null>(null)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [panning, setPanning] = useState(false)
  const [size, setSize] = useState({ x: 1000, y: 700 })
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<Pinch | null>(null)
  const space = useRef(false)
  const suppressClick = useRef(false)

  const current = useCallback(() => cameraRef.current, [])
  const publish = useCallback((next: Camera) => {
    cameraRef.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setCamera(cameraRef.current)
      save(keyRef.current, cameraRef.current)
    })
  }, [])
  const local = useCallback((position: { clientX: number; clientY: number }): Point => {
    const rect = stage.current!.getBoundingClientRect()
    return { x: position.clientX - rect.left, y: position.clientY - rect.top }
  }, [])
  const cancelDrag = useCallback(() => {
    const active = gesture.current
    gesture.current = null
    active?.session?.cancel()
  }, [])
  // Before paint, so a key's first frame is never drawn through the previous key's camera.
  useLayoutEffect(() => {
    if (keyRef.current !== persistKey && frame.current !== null) {
      save(keyRef.current, cameraRef.current)
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    keyRef.current = persistKey
    cameraRef.current = load(persistKey)
    setCamera(cameraRef.current)
    cancelDrag()
  }, [persistKey, cancelDrag])
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

  const fit = (selection = false) => {
    const target = bounds?.(selection)
    if (target) publish(fitCamera(target, size))
  }
  const zoomTo = (zoom: number) => publish(zoomAt(cameraRef.current, zoom, { x: size.x / 2, y: size.y / 2 }))
  const canClick = () => !suppressClick.current && !space.current && tool !== 'hand'

  const control = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-canvas-control]')
  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    const element = stage.current
    if (!element || event.button === 2) return
    const wantsPan = event.button === 1 || space.current || tool === 'hand'
    const context = (): GestureContext => {
      const point = local(event)
      return {
        point,
        world: worldAt(cameraRef.current, point),
        camera: cameraRef.current,
        wantsPan,
        element,
        current,
        local,
      }
    }
    let start: DragSession | 'pan' | undefined
    if (control(event.target)) {
      const claimed = drag?.control?.(event, context()) ?? 'none'
      if (claimed === 'none') return
      start = claimed
    }
    suppressClick.current = false
    element.focus({ preventScroll: true })
    if (start && start !== 'pan') {
      // A handle: the drag begins at once, before any touch bookkeeping.
      gesture.current = {
        pointer: event.pointerId,
        start: local(event),
        camera: cameraRef.current,
        moved: false,
        session: start,
      }
      element.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    if (event.pointerType === 'touch') {
      pointers.current.set(event.pointerId, local(event))
      element.setPointerCapture(event.pointerId)
      if (pointers.current.size === 2) {
        cancelDrag()
        const [a, b] = [...pointers.current.values()]
        const center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
        pinch.current = {
          camera: cameraRef.current,
          anchor: worldAt(cameraRef.current, center),
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        }
        suppressClick.current = true
        event.preventDefault()
        return
      }
    }
    if (!start) {
      const began = wantsPan ? 'pan' : (drag?.start(event, context()) ?? 'pan')
      if (began === 'none') return
      start = began
    }
    const session = start === 'pan' ? null : start
    gesture.current = {
      pointer: event.pointerId,
      start: local(event),
      camera: cameraRef.current,
      moved: false,
      session,
    }
    if (!session) {
      setPanning(true)
      element.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  })
  const onPointerMove = useEffectEvent((event: PointerEvent) => {
    const element = stage.current!
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
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const point = local(event),
      delta = { x: point.x - active.start.x, y: point.y - active.start.y }
    if (Math.hypot(delta.x, delta.y) > 3) {
      active.moved = true
      suppressClick.current = true
      element.setPointerCapture(event.pointerId)
    }
    if (!active.moved) return
    if (active.session) active.session.move(point, delta, event)
    else publish({ ...active.camera, x: active.camera.x + delta.x, y: active.camera.y + delta.y })
  })
  const onPointerUp = useEffectEvent((event: PointerEvent) => {
    const active = gesture.current
    pointers.current.delete(event.pointerId)
    if (active?.pointer === event.pointerId) {
      gesture.current = null
      if (event.type === 'pointercancel') active.session?.cancel()
      else if (active.session) {
        const point = local(event)
        if (active.moved || active.session.immediate) suppressClick.current = true
        active.session.end(point, { x: point.x - active.start.x, y: point.y - active.start.y }, active.moved, event)
      }
    }
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 1) {
      const [pointer, point] = [...pointers.current.entries()][0]!
      gesture.current = { pointer, start: point, camera: cameraRef.current, moved: true, session: null }
    }
    if (!pointers.current.size) setPanning(false)
    setTimeout(() => {
      suppressClick.current = false
    }, 0)
  })
  const onWheel = useEffectEvent((event: WheelEvent) => {
    const element = stage.current!
    // Controls in the world, such as handles, still scroll the canvas; the toolbar and help do not.
    if (control(event.target) && !(event.target as Element).closest('[data-canvas-world]')) return
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
    if (gesture.current?.moved) gesture.current.session?.refresh?.()
  })
  const safari = useRef<Pinch | null>(null)
  const onSafariStart = useEffectEvent((event: Event) => {
    event.preventDefault()
    if (gesture.current?.session) {
      cancelDrag()
      suppressClick.current = true
    }
    safari.current = {
      camera: cameraRef.current,
      anchor: worldAt(cameraRef.current, local(event as SafariGesture)),
      distance: 1,
    }
  })
  const onSafariChange = useEffectEvent((event: Event) => {
    event.preventDefault()
    const pinching = safari.current
    if (pinching)
      publish(
        pinchCamera(pinching.camera, pinching.anchor, local(event as SafariGesture), (event as SafariGesture).scale),
      )
  })
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const element = stage.current!
    const active = gesture.current
    if (event.key === 'Escape' && active?.session) {
      event.preventDefault()
      cancelDrag()
      suppressClick.current = true
      return
    }
    if ((event.key === 'Alt' || event.key === 'Shift') && active?.moved) {
      active.session?.refresh?.(event)
      return
    }
    const editing =
      event.target instanceof Element &&
      !!event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
    if (control(event.target) || editing || document.querySelector('[role="dialog"], [role="menu"]')) return
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
      if (event.code === 'Digit1') fit()
      if (event.code === 'Digit2') fit(true)
    } else if (['+', '=', '-', '_'].includes(key)) {
      event.preventDefault()
      publish(zoomAt(cameraRef.current, cameraRef.current.zoom * (key === '+' || key === '=' ? 1.25 : 0.8), center))
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && (key === 'h' || key === 'v')) {
      event.preventDefault()
      setTool(key === 'h' ? 'hand' : 'select')
    }
    if (gesture.current?.moved) gesture.current.session?.refresh?.()
  })
  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if ((event.key === 'Alt' || event.key === 'Shift') && gesture.current?.moved)
      gesture.current.session?.refresh?.(event)
    if (event.code === 'Space') {
      space.current = false
      setPanning(false)
    }
  })
  const onBlur = useEffectEvent(() => {
    space.current = false
    cancelDrag()
    pinch.current = null
    pointers.current.clear()
    setPanning(false)
  })
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const down = (event: PointerEvent) => onPointerDown(event)
    const move = (event: PointerEvent) => onPointerMove(event)
    const up = (event: PointerEvent) => onPointerUp(event)
    const wheel = (event: WheelEvent) => onWheel(event)
    const safariStart = (event: Event) => onSafariStart(event)
    const safariChange = (event: Event) => onSafariChange(event)
    const safariEnd = (event: Event) => {
      event.preventDefault()
      safari.current = null
    }
    const keydown = (event: KeyboardEvent) => onKeyDown(event)
    const keyup = (event: KeyboardEvent) => onKeyUp(event)
    const blur = () => onBlur()
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
  }, [])

  return { stage, camera, current, publish, size, tool, setTool, panning, canClick, fit, zoomTo, cancelDrag }
}

export type CanvasState = ReturnType<typeof useCanvas>
