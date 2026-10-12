/** Camera coordinates are screen pixels; object coordinates are unscaled canvas units. */
export interface Point {
  x: number
  y: number
}
export interface Camera extends Point {
  zoom: number
}
export interface Bounds extends Point {
  width: number
  height: number
}
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function worldAt(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }
}

export function zoomAt(camera: Camera, zoom: number, point: Point): Camera {
  const anchor = worldAt(camera, point)
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  return { x: point.x - anchor.x * next, y: point.y - anchor.y * next, zoom: next }
}

export function fitCamera(bounds: Bounds, viewport: Point, padding = 48): Camera {
  const width = Math.max(1, viewport.x - padding * 2)
  const height = Math.max(1, viewport.y - padding * 2)
  const zoom = Math.min(
    2,
    Math.max(MIN_ZOOM, Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height))),
  )
  return {
    x: padding + (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: padding + (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

/** Reveal an opened card at a readable scale without disturbing an already useful view. */
export function revealCamera(camera: Camera, bounds: Bounds, viewport: Point, padding = 32): Camera {
  const width = Math.max(1, viewport.x - padding * 2)
  const height = Math.max(1, viewport.y - padding * 2)
  const fittingZoom = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height))
  const zoom = Math.max(MIN_ZOOM, Math.min(fittingZoom, Math.max(camera.zoom, Math.min(1, fittingZoom))))
  const left = camera.x + bounds.x * zoom
  const top = camera.y + bounds.y * zoom
  if (
    zoom === camera.zoom &&
    left >= padding &&
    top >= padding &&
    left + bounds.width * zoom <= viewport.x - padding &&
    top + bounds.height * zoom <= viewport.y - padding
  )
    return camera
  return {
    x: (viewport.x - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (viewport.y - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

/** Recover an empty overview on entry; callers must not repeat this during manual navigation. */
export function overviewCamera(camera: Camera, content: Bounds[], viewport: Point, bounds?: Bounds): Camera {
  const hasVisibleWork = (candidate: Camera) =>
    content.some((item) => {
      const left = candidate.x + item.x * candidate.zoom
      const top = candidate.y + item.y * candidate.zoom
      const width = item.width * candidate.zoom
      const height = item.height * candidate.zoom
      return (
        Math.min(viewport.x - 32, left + width) - Math.max(32, left) >= Math.min(48, width) &&
        Math.min(viewport.y - 32, top + height) - Math.max(32, top) >= Math.min(24, height)
      )
    })
  if (!content.length || viewport.x <= 0 || viewport.y <= 0 || hasVisibleWork(camera)) return camera
  const x = Math.min(...content.map((item) => item.x))
  const y = Math.min(...content.map((item) => item.y))
  const fitted = fitCamera(
    bounds ?? {
      x,
      y,
      width: Math.max(...content.map((item) => item.x + item.width)) - x,
      height: Math.max(...content.map((item) => item.y + item.height)) - y,
    },
    viewport,
  )
  const next = zoomAt(fitted, Math.min(1, fitted.zoom), { x: viewport.x / 2, y: viewport.y / 2 })
  // Extremely distant cards can straddle an empty viewport even at minimum zoom.
  return hasVisibleWork(next) ? next : revealCamera({ ...camera, zoom: 1 }, content[0]!, viewport)
}

export function dragPoint(start: Point, screenDelta: Point, zoom: number): Point {
  return { x: start.x + screenDelta.x / zoom, y: start.y + screenDelta.y / zoom }
}

export function pinchCamera(start: Camera, anchor: Point, center: Point, ratio: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.zoom * ratio))
  return { x: center.x - anchor.x * zoom, y: center.y - anchor.y * zoom, zoom }
}

export function wheelCamera(
  camera: Camera,
  point: Point,
  wheel: { x: number; y: number; zoom: boolean; shift: boolean },
): Camera {
  if (wheel.zoom) return zoomAt(camera, camera.zoom * Math.exp(-Math.max(-24, Math.min(24, wheel.y)) * 0.01), point)
  return {
    ...camera,
    x: camera.x - (wheel.shift ? wheel.x + wheel.y : wheel.x),
    y: camera.y - (wheel.shift ? 0 : wheel.y),
  }
}

/** An old or damaged preference must never make the canvas disappear. */
export function readCamera(value: unknown, fallback: Camera = { x: 48, y: 68, zoom: 1 }): Camera {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Camera
  return Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.zoom) &&
    candidate.zoom >= MIN_ZOOM &&
    candidate.zoom <= MAX_ZOOM
    ? candidate
    : fallback
}
