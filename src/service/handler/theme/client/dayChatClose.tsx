import './dayChatClose.css'
import { ActionIcon, Button, Drawer, Modal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import type { ChatCloseResult } from './chat.tsx'
import { useItemEditing } from './dayItemEditing.tsx'

export interface ChatCloseNotice extends ChatCloseResult {
  id: string
  title: string
}

const DISPLAY_MS = 20000

/** One chat result at a time, sharing the day's temporary notification space with Undo. */
export function DayChatClose({
  notice,
  blocked,
  onDismiss,
}: {
  notice: ChatCloseNotice
  blocked: boolean
  onDismiss: (id: string) => void
}) {
  const editing = useItemEditing()
  const [opened, setOpened] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const mobile = useMediaQuery('(max-width: 900px)') ?? false
  const failed = notice.notes.some((note) => note.tone === 'failed')
  const covered = blocked || editing.feedbackActive
  const paused = covered || opened || hovered || focused || hidden
  const remaining = useRef(DISPLAY_MS)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    const change = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])

  useEffect(() => {
    if (paused || failed) return
    const started = performance.now()
    const timer = setTimeout(() => dismiss.current(notice.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [paused, failed, notice.id])

  const details = (
    <>
      <p className="sky-chat-close-title">{notice.title}</p>
      <ul className="sky-chat-close-details">
        {notice.notes.map((note, index) => (
          <li key={index} data-tone={note.tone}>
            {note.text}
          </li>
        ))}
      </ul>
      <div className="sky-dialog-actions">
        <Button onClick={() => setOpened(false)}>Done</Button>
      </div>
    </>
  )
  const dialog = { opened, onClose: () => setOpened(false), title: notice.summary }

  return (
    <>
      <div
        className="sky-undo sky-chat-close-toast"
        data-covered={covered || opened}
        data-paused={paused}
        data-failed={failed}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        <span className="sky-undo-text" role={failed ? 'alert' : 'status'}>
          {failed ? 'Chat needs attention' : notice.summary} — {notice.title}
        </span>
        <Button variant="primary-quiet" size="compact-sm" onClick={() => setOpened(true)}>
          View
        </Button>
        <ActionIcon variant="secondary" aria-label="Dismiss chat notification" onClick={() => onDismiss(notice.id)}>
          ×
        </ActionIcon>
        {!failed && (
          <span className="sky-undo-track" aria-hidden="true">
            <span className="sky-undo-fill" />
          </span>
        )}
      </div>
      {mobile ? (
        <Drawer {...dialog} position="bottom" size="auto">
          {details}
        </Drawer>
      ) : (
        <Modal {...dialog} size={640} centered>
          {details}
        </Modal>
      )}
    </>
  )
}
