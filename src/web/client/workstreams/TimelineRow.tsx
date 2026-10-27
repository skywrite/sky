import type { Key } from 'react'
import { WorkstreamConnector } from './WorkstreamConnector.tsx'
import type { CanvasActivity, CanvasWorkstream } from './workstreamsCanvas.tsx'
import { workstreamColorStyle } from './workstreamsColors.tsx'
import { openWorkstreamMenu, WorkstreamMenuButton, type WorkstreamMenuTarget } from './workstreamsMenu.tsx'

export type ActivityBox = { x: number; y: number; width: number }

export function TimelineRow({
  item,
  top,
  height,
  laneLeft,
  dragging,
  selected,
  muted,
  dropTarget,
  zoom,
  disabled,
  activityBox,
  onOpen,
  onMenu,
  onRelate,
}: {
  key?: Key | null
  item: CanvasWorkstream
  top: number
  height: number
  laneLeft: number
  dragging: boolean
  selected: boolean
  muted: boolean
  dropTarget: boolean
  zoom: number
  disabled: boolean
  activityBox: (item: CanvasWorkstream, activity: CanvasActivity) => ActivityBox
  onOpen: (id: string) => void
  onMenu: (target: WorkstreamMenuTarget) => void
  onRelate: (fromId: string) => void
}) {
  return (
    <div
      className="sky-workstreams-lane"
      data-workstream={item.id}
      data-color={item.color ?? 'blue'}
      data-muted={muted}
      data-drop-target={dropTarget}
      onContextMenu={(event) => openWorkstreamMenu(event, item.id, item.title, onMenu)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          openWorkstreamMenu(event, item.id, item.title, onMenu)
      }}
      data-dragging={dragging}
      style={{ ...workstreamColorStyle(item.color), top, height }}
    >
      <div
        className="sky-workstreams-lane-label"
        data-workstream={item.id}
        data-lane-drag
        data-selected={selected}
        title="Drag vertically to reorder. Hold Space to pan."
        style={{ left: laneLeft }}
      >
        <button type="button" className="sky-workstreams-lane-open" onClick={() => onOpen(item.id)}>
          <strong>{item.title}</strong>
          <span>
            {item.status !== 'active' && `${item.status[0]!.toUpperCase()}${item.status.slice(1)} · `}
            {item.activities.length
              ? `${item.activities.length} ${item.activities.length === 1 ? 'activity' : 'activities'}`
              : 'No activities yet'}
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
      {!item.activities.length && (
        <button
          type="button"
          className="sky-workstreams-unscheduled"
          style={{ left: laneLeft, top: 115 }}
          data-workstream={item.id}
          onClick={() => onOpen(item.id)}
        >
          Define the next useful action →
        </button>
      )}
      {item.activities.some((activity) => !activity.start) && (
        <span className="sky-workstreams-undated-label" style={{ left: laneLeft + 4 }}>
          Unscheduled
        </span>
      )}
      {item.activities.map((activity) => (
        <ActivityClip
          key={activity.id}
          workstreamId={item.id}
          activity={activity}
          box={activityBox(item, activity)}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function ActivityClip({
  workstreamId,
  activity,
  box,
  onOpen,
}: {
  key?: Key | null
  workstreamId: string
  activity: CanvasActivity
  box: ActivityBox
  onOpen: (id: string) => void
}) {
  const done = activity.status === 'done' || activity.status === 'decided'
  return (
    <button
      type="button"
      className="sky-workstreams-clip"
      data-workstream={workstreamId}
      data-activity={activity.id}
      data-scheduled={!!activity.start}
      data-kind={activity.kind}
      data-done={done}
      title={`${activity.title} · ${done ? 'Completed' : activity.kind === 'decision' ? 'Decision' : 'Action'}`}
      onClick={() => onOpen(workstreamId)}
      style={{ left: box.x, width: box.width, top: box.y }}
    >
      <span>
        {done ? '✓ ' : activity.kind === 'decision' ? '◇ ' : ''}
        {activity.title}
      </span>
    </button>
  )
}
