import { ActionIcon, Button } from '@mantine/core'
import { useState } from 'react'
import type { WorkstreamView } from './workstreamsCanvas.tsx'

export type CanvasTool = 'select' | 'hand'

export function CanvasToolbar({
  view,
  tool,
  onToolChange,
  snapping,
  onSnappingChange,
  zoom,
  onZoomOut,
  onZoomReset,
  onZoomIn,
  onFit,
}: {
  view: WorkstreamView
  tool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  snapping: boolean
  onSnappingChange: (snapping: boolean) => void
  zoom: number
  onZoomOut: () => void
  onZoomReset: () => void
  onZoomIn: () => void
  onFit: () => void
}) {
  const [help, setHelp] = useState(false)
  return (
    <>
      <div className="sky-workstreams-dock" data-canvas-control>
        <ActionIcon
          aria-label="Select tool (V)"
          title="Select (V)"
          variant={tool === 'select' ? 'light' : 'subtle'}
          onClick={() => onToolChange('select')}
        >
          ↖
        </ActionIcon>
        <ActionIcon
          aria-label="Hand tool (H)"
          title="Pan (H or hold Space)"
          variant={tool === 'hand' ? 'light' : 'subtle'}
          onClick={() => onToolChange('hand')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v6c0 4-2 6-6 6h-1c-3 0-4-2-5-4l-4-5a1.5 1.5 0 0 1 2-2l2 1Z" />
          </svg>
        </ActionIcon>
        <span className="sky-workstreams-dock-divider" />
        {view === 'map' && (
          <ActionIcon
            aria-label="Snap to workstreams"
            aria-pressed={snapping}
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
        <ActionIcon aria-label="Zoom out (-)" disabled={zoom <= 0.1} onClick={onZoomOut}>
          −
        </ActionIcon>
        <button type="button" className="sky-workstreams-zoom" title="Reset to 100% (Shift+0)" onClick={onZoomReset}>
          {Math.round(zoom * 100)}%
        </button>
        <ActionIcon aria-label="Zoom in (+)" disabled={zoom >= 8} onClick={onZoomIn}>
          ＋
        </ActionIcon>
        <Button size="xs" onClick={onFit} title="Fit all (Shift+1)">
          Fit
        </Button>
        <ActionIcon aria-label="Canvas controls" onClick={() => setHelp(!help)}>
          ?
        </ActionIcon>
      </div>
      {help && <CanvasHelp view={view} />}
    </>
  )
}

function CanvasHelp({ view }: { view: WorkstreamView }) {
  return (
    <div className="sky-workstreams-help" data-canvas-control>
      <strong>Move around the work</strong>
      <p>Scroll to pan. Pinch or Ctrl / ⌘ + scroll to zoom.</p>
      <p>
        <kbd>＋</kbd> / <kbd>−</kbd> Zoom
        <br />
        <kbd>Space</kbd> + drag Pan
        <br />
        <kbd>Shift 0</kbd> Actual size
        <br />
        <kbd>Shift 1</kbd> Fit all
        <br />
        <kbd>Shift 2</kbd> Fit selection
      </p>
      <p>
        {view === 'map'
          ? 'Drag a card to align its edges, center, or spacing with nearby workstreams. The magnet turns snapping on or off.'
          : 'Drag a lane heading vertically to reorder workstreams. Drag a dated activity horizontally to change its planned dates.'}
      </p>
      {view === 'map' && (
        <p>
          <kbd>Option / Alt</kbd> Move freely
          <br />
          <kbd>Shift</kbd> Keep a drag straight
          <br />
          <kbd>Esc</kbd> Cancel a drag
        </p>
      )}
      <p>
        Drag a card’s link handle to another workstream to relate them. Select a line to understand or edit the
        relationship. On touch, use the workstream’s three-dot menu.
      </p>
    </div>
  )
}
