import { Tooltip } from '@mantine/core'
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { splitChatFiles } from '#universal/ai/chatFiles.ts'
import type { Turn } from './chat.tsx'
import './chatNavigation.css'

export function chatMessageId(chatId: string, turn: Turn, index: number): string {
  return `chat-${chatId}-${turn.branchPoint ? `reply-${turn.branchPoint.turn}` : `message-${index + 1}`}`
}

function revealMarker(marker: HTMLButtonElement) {
  const list = marker.closest<HTMLElement>('.sky-turn-nav')!
  if (marker.offsetTop < list.scrollTop) list.scrollTop = marker.offsetTop
  else if (marker.offsetTop + marker.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = marker.offsetTop + marker.offsetHeight - list.clientHeight
}

export function ChatTurnNavigation({
  chatId,
  turns,
  scroll,
  onNavigate,
  firstVisible = 0,
  temporary = false,
  visible = true,
}: {
  chatId: string
  turns: Turn[]
  scroll: RefObject<HTMLDivElement | null>
  onNavigate: () => void
  firstVisible?: number
  temporary?: boolean
  visible?: boolean
}) {
  const nav = useRef<HTMLElement>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const entries = useMemo(
    () =>
      turns.flatMap((turn, index) => {
        if (turn.role !== 'user' || index < firstVisible) return []
        const { text, files } = splitChatFiles(turn.content)
        const label = (text || [...files, ...(turn.files ?? [])].map((file) => file.name).join(', ') || 'Attachment')
          .replace(/\s+/g, ' ')
          .trim()
        return [
          { id: chatMessageId(chatId, turn, index), preview: label.length > 180 ? `${label.slice(0, 177)}…` : label },
        ]
      }),
    [chatId, turns, firstVisible],
  )
  // Content streams frequently; only a change of destinations rebuilds the observers.
  const destinations = entries.map((entry) => entry.id).join('\n')
  useEffect(() => {
    const area = scroll.current
    if (!area || !visible || !destinations) return
    const messages = destinations
      .split('\n')
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null && area.contains(element))
    let frame = 0
    const update = () => {
      if (!area.clientHeight) return
      const readingLine = area.getBoundingClientRect().top + 40
      let selected = messages[0]
      for (const message of messages) {
        if (message.getBoundingClientRect().top > readingLine) break
        selected = message
      }
      if (area.scrollHeight - area.scrollTop - area.clientHeight <= 2) selected = messages.at(-1)
      setCurrent(selected?.id ?? null)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    area.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(area)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      area.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [scroll, destinations, visible])

  useEffect(() => {
    const marker = nav.current?.querySelector<HTMLButtonElement>('[aria-current="step"]')
    if (marker && !nav.current?.matches(':hover, :focus-within')) revealMarker(marker)
  }, [current])

  const jump = (id: string) => {
    const area = scroll.current
    const message = document.getElementById(id)
    if (!area || !message || !area.contains(message)) return
    onNavigate()
    area.scrollTo({
      top: area.scrollTop + message.getBoundingClientRect().top - area.getBoundingClientRect().top - 24,
      behavior: 'instant',
    })
    setCurrent(id)
  }
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = [...(nav.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowUp'
            ? Math.max(0, index - 1)
            : event.key === 'ArrowDown'
              ? Math.min(buttons.length - 1, index + 1)
              : null
    if (next === null) return
    event.preventDefault()
    const button = buttons[next]
    if (button) {
      button.focus({ preventScroll: true })
      revealMarker(button)
    }
  }

  if (!visible || entries.length < 2) return null
  const active = current ?? entries[0]!.id
  return (
    <nav
      className="sky-turn-nav"
      aria-label="Conversation turns"
      data-temporary={temporary}
      ref={nav}
      onKeyDown={moveFocus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null)
      }}
    >
      {entries.map((entry, index) => (
        <Tooltip
          key={entry.id}
          label={
            <>
              <span className="sky-turn-nav-preview-count">
                Turn {index + 1} of {entries.length}
              </span>
              <span>{entry.preview}</span>
            </>
          }
          classNames={{ tooltip: 'sky-turn-nav-preview' }}
          data-temporary={temporary}
          position="left"
          offset={8}
          multiline
          openDelay={150}
          events={{ hover: true, focus: true, touch: false }}
        >
          <button
            type="button"
            aria-label={`Go to turn ${index + 1}: ${entry.preview}`}
            aria-controls={entry.id}
            aria-current={entry.id === active ? 'step' : undefined}
            tabIndex={entry.id === (focused ?? active) ? 0 : -1}
            onFocus={() => setFocused(entry.id)}
            onClick={() => jump(entry.id)}
          >
            <span aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
    </nav>
  )
}
