import type { Key } from 'react'
import { CARD_HEIGHT, CARD_WIDTH } from '#lib/workstreams/layout.ts'
import type { Point } from './camera.ts'
import { workstreamColorStyle } from './colors.ts'
import { WorkstreamConnector } from './WorkstreamConnector.tsx'
import { WorkstreamMenuButton } from './WorkstreamMenuButton.tsx'
import type { CanvasWorkstream } from './WorkstreamsCanvas.tsx'
import { openWorkstreamMenu, type WorkstreamMenuTarget } from './WorkstreamsMenu.tsx'

export function MapCard({
  item,
  point,
  selected,
  muted,
  dropTarget,
  zoom,
  disabled,
  onOpen,
  onMenu,
  onRelate,
}: {
  key?: Key | null
  item: CanvasWorkstream
  point: Point
  selected: boolean
  muted: boolean
  dropTarget: boolean
  zoom: number
  disabled: boolean
  onOpen: (id: string) => void
  onMenu: (target: WorkstreamMenuTarget) => void
  onRelate: (fromId: string) => void
}) {
  const openActivities = item.activities.filter(
    (activity) => activity.status !== 'done' && activity.status !== 'decided',
  ).length
  const summary =
    item.status === 'active'
      ? item.attention || `Active · ${openActivities} open ${openActivities === 1 ? 'activity' : 'activities'}`
      : item.status === 'proposed'
        ? 'Proposed'
        : item.status === 'paused'
          ? 'Paused'
          : item.status === 'completed'
            ? 'Completed'
            : 'Canceled'
  return (
    <div
      className="sky-workstreams-card"
      data-workstream={item.id}
      data-state={item.status}
      data-color={item.color ?? 'blue'}
      data-attention={item.needsAttention}
      data-selected={selected}
      data-muted={muted}
      data-drop-target={dropTarget}
      onContextMenu={(event) => openWorkstreamMenu(event, item.id, item.title, onMenu)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          openWorkstreamMenu(event, item.id, item.title, onMenu)
      }}
      style={{
        ...workstreamColorStyle(item.color),
        left: point.x,
        top: point.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      }}
    >
      <button type="button" className="sky-workstreams-card-open" onClick={() => onOpen(item.id)}>
        <strong title={item.title}>{item.title}</strong>
        <span className="sky-workstreams-card-outcome" title={item.outcome}>
          {item.outcome || 'The outcome is taking shape.'}
        </span>
        <span className="sky-workstreams-card-bottom">
          <span className="sky-workstreams-card-summary">
            {item.parentId && 'Sub-workstream · '}
            {summary}
          </span>
          {item.status === 'active' && (
            <span
              className="sky-workstreams-card-assistance"
              data-assisting={item.assistance !== 'off' && item.assistance !== 'manual'}
            >
              {item.assistance === 'off' || item.assistance === 'manual'
                ? 'You’re leading'
                : item.assistance === 'drive'
                  ? 'Sky driving'
                  : 'Sky assisting'}
            </span>
          )}
        </span>
      </button>
      <WorkstreamMenuButton
        workstreamId={item.id}
        title={item.title}
        onMenu={onMenu}
        disabled={disabled}
        className="sky-workstreams-canvas-menu"
        style={{ transform: `scale(${1 / zoom})` }}
      />
      <WorkstreamConnector
        workstreamId={item.id}
        title={item.title}
        zoom={zoom}
        disabled={disabled}
        onRelate={onRelate}
      />
    </div>
  )
}
