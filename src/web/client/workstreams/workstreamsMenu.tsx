import { ActionIcon, Button, Drawer, Menu, Portal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type CSSProperties, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef } from 'react'
import type { WorkstreamColor } from '#lib/workstreams/colors.ts'
import { WorkstreamColorPicker } from './workstreamsColors.tsx'

export type WorkstreamMenuTarget = {
  workstreamId: string
  title: string
  x: number
  y: number
  trigger: HTMLElement
}

export function openWorkstreamMenu(
  event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  workstreamId: string,
  title: string,
  onMenu: (target: WorkstreamMenuTarget) => void,
) {
  event.preventDefault()
  event.stopPropagation()
  const origin = event.currentTarget
  const clicked = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [tabindex]') : null
  const trigger =
    clicked && origin.contains(clicked)
      ? clicked
      : origin.matches('button, [tabindex]')
        ? origin
        : (origin.querySelector<HTMLElement>('button') ?? origin)
  const bounds = trigger.getBoundingClientRect()
  const pointer = event.type === 'contextmenu' && 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0)
  onMenu({
    workstreamId,
    title,
    trigger,
    x: pointer ? event.clientX : bounds.left,
    y: pointer ? event.clientY : bounds.bottom,
  })
}

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

export function WorkstreamsMenu({
  target,
  onClose,
  onOpen,
  onDelete,
  onRelate,
  color,
  onColor,
  busy = false,
}: {
  target: WorkstreamMenuTarget | null
  onClose: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onRelate: (id: string) => void
  color?: WorkstreamColor
  onColor: (id: string, color: WorkstreamColor) => void
  busy?: boolean
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const dropdown = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!target || phone) return
    const frame = requestAnimationFrame(() =>
      dropdown.current?.querySelector<HTMLButtonElement>('[data-menu-item]:not(:disabled)')?.focus(),
    )
    return () => cancelAnimationFrame(frame)
  }, [target, phone])
  const close = useCallback(() => {
    if (!target) return
    const closingMenu = dropdown.current
    onClose()
    requestAnimationFrame(() => {
      const active = document.activeElement
      // Outside clicks keep focus on their destination; Escape returns it to the menu trigger.
      if (active instanceof HTMLElement && active !== document.body && !closingMenu?.contains(active)) return
      const trigger = target.trigger.isConnected
        ? target.trigger
        : document.querySelector<HTMLElement>('.sky-workstreams-canvas')
      trigger?.focus({ preventScroll: true })
    })
  }, [target, onClose])
  useEffect(() => {
    if (!target || phone) return
    const outside = (event: Event) => {
      if (dropdown.current && !event.composedPath().includes(dropdown.current)) close()
    }
    // Capture before canvas/controls consume the event. Click also covers activation without a pointer.
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('click', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('click', outside, true)
    }
  }, [target, phone, close])
  if (!target) return null
  const choose = (action: (id: string) => void) => {
    onClose()
    action(target.workstreamId)
  }
  const chooseColor = (value: WorkstreamColor) => {
    close()
    onColor(target.workstreamId, value)
  }
  if (phone)
    return (
      <Drawer
        opened
        onClose={close}
        title={target.title}
        position="bottom"
        size="auto"
        returnFocus={false}
        closeOnClickOutside
      >
        <div className="sky-workstream-menu-actions">
          <Button variant="secondary" fullWidth disabled={busy} onClick={() => choose(onOpen)}>
            Open workstream
          </Button>
          <Button variant="secondary" fullWidth disabled={busy} onClick={() => choose(onRelate)}>
            Relate to…
          </Button>
          <div className="sky-workstream-color-section">
            <span>Color</span>
            <WorkstreamColorPicker color={color} onChange={chooseColor} disabled={busy} />
          </div>
          <Button variant="danger-quiet" fullWidth disabled={busy} onClick={() => choose(onDelete)}>
            Delete workstream
          </Button>
        </div>
      </Drawer>
    )
  // This reference is a viewport point, not a visible control. Flip/shift position the menu without detached-element hiding.
  return (
    <Portal>
      <Menu
        opened
        onChange={(opened) => {
          if (!opened) close()
        }}
        position="bottom-start"
        width={260}
        shadow="md"
        withinPortal
        floatingStrategy="fixed"
        hideDetached={false}
        returnFocus={false}
        closeOnItemClick={false}
        closeOnClickOutside={false}
        withInitialFocusPlaceholder={false}
        middlewares={{ flip: true, shift: { padding: 8 } }}
      >
        <Menu.Target>
          <span
            aria-hidden="true"
            className="sky-workstream-menu-anchor"
            style={{
              left: Math.max(8, Math.min(window.innerWidth - 8, target.x)),
              top: Math.max(8, Math.min(window.innerHeight - 8, target.y)),
            }}
          />
        </Menu.Target>
        <Menu.Dropdown ref={dropdown} aria-label={`Workstream menu for ${target.title}`}>
          <Menu.Label className="sky-workstream-menu-title">{target.title}</Menu.Label>
          <Menu.Item disabled={busy} onClick={() => choose(onOpen)}>
            Open workstream
          </Menu.Item>
          <Menu.Item disabled={busy} onClick={() => choose(onRelate)}>
            Relate to…
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>Color</Menu.Label>
          <WorkstreamColorPicker color={color} onChange={chooseColor} disabled={busy} inMenu />
          <Menu.Divider />
          <Menu.Item className="sky-workstream-menu-delete" disabled={busy} onClick={() => choose(onDelete)}>
            Delete workstream
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Portal>
  )
}
