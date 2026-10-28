import type { HTMLAttributes, ReactNode } from 'react'
import type { CanvasState } from './useCanvas.ts'
import './Canvas.css'

export function Canvas({
  canvas,
  className,
  children,
  overlay,
  style,
  ...rest
}: {
  canvas: CanvasState
  className?: string
  /** Drawn in world coordinates: it pans and zooms with the camera. */
  children?: ReactNode
  /** Drawn over the stage in screen coordinates: toolbars, hints, empty states. */
  overlay?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const { camera } = canvas
  return (
    <div
      ref={canvas.stage}
      className={className ? `sky-canvas ${className}` : 'sky-canvas'}
      data-panning={canvas.panning || canvas.tool === 'hand'}
      tabIndex={0}
      style={{ backgroundPosition: `${camera.x % 24}px ${camera.y % 24}px`, ...style }}
      {...rest}
    >
      <div
        className="sky-canvas-world"
        data-canvas-world
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {children}
      </div>
      {overlay}
    </div>
  )
}
