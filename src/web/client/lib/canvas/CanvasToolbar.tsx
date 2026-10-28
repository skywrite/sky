import { ActionIcon, Button } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import type { CanvasState } from './useCanvas.ts'

export function CanvasToolbar({
  canvas,
  snapping,
  snappingLabel = 'Snap to neighbors',
  onSnappingChange,
  help,
}: {
  canvas: CanvasState
  /** Shown when `onSnappingChange` is given. */
  snapping?: boolean
  snappingLabel?: string
  onSnappingChange?: (snapping: boolean) => void
  /** What the ? button opens. */
  help?: ReactNode
}) {
  const [showHelp, setShowHelp] = useState(false)
  const { tool, setTool, camera } = canvas
  return (
    <>
      <div className="sky-canvas-dock" data-canvas-control>
        <ActionIcon
          aria-label="Select tool (V)"
          title="Select (V)"
          variant={tool === 'select' ? 'light' : 'subtle'}
          onClick={() => setTool('select')}
        >
          ↖
        </ActionIcon>
        <ActionIcon
          aria-label="Hand tool (H)"
          title="Pan (H or hold Space)"
          variant={tool === 'hand' ? 'light' : 'subtle'}
          onClick={() => setTool('hand')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v6c0 4-2 6-6 6h-1c-3 0-4-2-5-4l-4-5a1.5 1.5 0 0 1 2-2l2 1Z" />
          </svg>
        </ActionIcon>
        <span className="sky-canvas-dock-divider" />
        {onSnappingChange && (
          <ActionIcon
            aria-label={snappingLabel}
            aria-pressed={!!snapping}
            title={`Snapping ${snapping ? 'on' : 'off'} · Hold Option / Alt to move freely`}
            variant={snapping ? 'light' : 'subtle'}
            onClick={() => onSnappingChange(!snapping)}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M5 3v10a7 7 0 0 0 14 0V3h-4v10a3 3 0 0 1-6 0V3ZM5 7h4m6 0h4" />
            </svg>
          </ActionIcon>
        )}
        <ActionIcon
          aria-label="Zoom out (-)"
          disabled={camera.zoom <= 0.1}
          onClick={() => canvas.zoomTo(canvas.current().zoom / 1.25)}
        >
          −
        </ActionIcon>
        <button
          type="button"
          className="sky-canvas-zoom"
          title="Reset to 100% (Shift+0)"
          onClick={() => canvas.zoomTo(1)}
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <ActionIcon
          aria-label="Zoom in (+)"
          disabled={camera.zoom >= 8}
          onClick={() => canvas.zoomTo(canvas.current().zoom * 1.25)}
        >
          ＋
        </ActionIcon>
        <Button size="xs" onClick={() => canvas.fit()} title="Fit all (Shift+1)">
          Fit
        </Button>
        {help && (
          <ActionIcon aria-label="Canvas controls" onClick={() => setShowHelp(!showHelp)}>
            ?
          </ActionIcon>
        )}
      </div>
      {showHelp && (
        <div className="sky-canvas-help" data-canvas-control>
          {help}
        </div>
      )}
    </>
  )
}
