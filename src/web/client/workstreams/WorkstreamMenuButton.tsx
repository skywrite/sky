import { ActionIcon } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { CSSProperties } from 'react'
import { openWorkstreamMenu, type WorkstreamMenuTarget } from './WorkstreamsMenu.tsx'

export function WorkstreamMenuButton({
  workstreamId,
  title,
  onMenu,
  disabled,
  className = '',
  style,
}: {
  workstreamId: string
  title: string
  onMenu: (target: WorkstreamMenuTarget) => void
  disabled?: boolean
  className?: string
  style?: CSSProperties
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  return (
    <ActionIcon
      className={`sky-workstream-menu-trigger ${className}`}
      style={style}
      variant="secondary"
      aria-label={`Workstream menu for ${title}`}
      aria-haspopup={phone ? 'dialog' : 'menu'}
      title="Workstream menu"
      data-canvas-control
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => openWorkstreamMenu(event, workstreamId, title, onMenu)}
      onContextMenu={(event) => openWorkstreamMenu(event, workstreamId, title, onMenu)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          openWorkstreamMenu(event, workstreamId, title, onMenu)
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="19" cy="12" r="1.7" />
      </svg>
    </ActionIcon>
  )
}
