import { ActionIcon, Button, Tooltip } from '@mantine/core'
import { Lexer, type Token } from 'marked'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import type { Chat } from './chat.tsx'
import { stageChatDraft, useChatDraft } from './chatDraft.ts'
import type { DayItem, DayRef } from './day.tsx'
import { fileHref, resolvePath } from './explorer.tsx'

/** Copied item links still open from the source day, including links in its notes. */
function itemMarkdown(raw: string, source: string | null): string {
  if (!source) return raw
  const directory = source.split('/').slice(0, -1).join('/')
  const href = (value: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) return value
    const [, encoded, suffix] = /^([^?#]*)(.*)$/.exec(value)!
    let file = encoded
    try {
      file = decodeURIComponent(encoded)
    } catch {
      // A literal percent sign can be part of a filename.
    }
    return fileHref(file ? resolvePath(directory, file).replace(/^\/+/, '') : source) + suffix
  }
  const render = (token: Token): string => {
    if (token.type === 'link' || token.type === 'image') {
      const label = token.type === 'image' ? token.text : (token.tokens?.map(render).join('') ?? token.text)
      const title = token.title ? ` "${token.title.replace(/"/g, '&quot;')}"` : ''
      const url = href(token.href).replaceAll('(', '%28').replaceAll(')', '%29')
      return `${token.type === 'image' ? '!' : ''}[${label}](${url}${title})`
    }
    const children = token.type === 'list' ? token.items : 'tokens' in token ? token.tokens : []
    let cursor = 0
    let result = ''
    for (const child of children ?? []) {
      const at = token.raw.indexOf(child.raw, cursor)
      if (at < 0) continue
      result += token.raw.slice(cursor, at) + render(child)
      cursor = at + child.raw.length
    }
    return result + token.raw.slice(cursor)
  }
  return Lexer.lex(raw).map(render).join('')
}

function helpMessage(item: DayItem, day: DayRef, href: string | null): string {
  return [
    `Help me get this done: ${itemMarkdown(item.text, day.dayRelativePath)}`,
    'Use the context available to you and take the next useful step. Ask me for any information or decisions you need.',
    `From ${item.list} on ${day.ymd}${item.time ? ` at ${item.time}` : ''}.`,
    day.dayRelativePath ? `Source: [Day file](${fileHref(day.dayRelativePath)}).` : '',
    `Original item and notes:\n\n${itemMarkdown(item.raw, day.dayRelativePath)
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n')}`,
    href ? `Related: [${item.link?.title ?? item.text}](${href})` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Start through the normal chat hook, so the first reply streams and errors keep the draft. */
export function useItemHelpChat(chat: Chat, route: string, onOpen: (id: string) => void) {
  const pending = useRef<{ id: string; message: string } | null>(null)
  const currentRoute = useRef(route)
  currentRoute.current = route
  const draft = useChatDraft(chat.state.id)
  const { state, send } = chat

  useEffect(() => {
    const start = pending.current
    if (!start) return
    if (route !== `/thread/${start.id}`) {
      pending.current = null
      return
    }
    if (state.id !== start.id || !state.loaded || !state.settings || chat.tuning) return
    // An edited draft or an already-started conversation belongs to the person now.
    if (state.turns.length || draft.text !== start.message || draft.files.length || state.settings.saves) {
      pending.current = null
      return
    }
    if (state.phase !== 'idle' || draft.loading) return
    pending.current = null
    void send(start.message, [], () => draft.accepted(start.message, []))
  }, [route, state.id, state.loaded, state.settings, state.turns.length, state.phase, chat.tuning, draft, send])

  return async (message: string) => {
    // An ephemeral routing key keeps private task text out of browser URLs.
    // If the person later saves, the chat's existing naming flow names its file.
    const id = crypto.randomUUID()
    const sourceRoute = route
    const response = await fetch(`/chat/${id}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saves: false }),
    })
    const body = (await response.json().catch(() => ({}))) as { saves?: boolean; message?: string }
    if (!response.ok || body.saves !== false)
      throw new Error(body.message ?? 'Could not open a temporary chat. Try again.')
    if (currentRoute.current !== sourceRoute) return
    const error = stageChatDraft(id, message)
    if (error) throw new Error(error)
    pending.current = { id, message }
    onOpen(id)
  }
}

const HelpContext = createContext<{
  start: (item: DayItem, href: string | null) => void
  busy: boolean
} | null>(null)

export function DayItemHelp({
  day,
  onStart,
  children,
}: {
  day: DayRef | null
  onStart?: (message: string) => Promise<void>
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const starting = useRef(false)
  const start = async (item: DayItem, href: string | null) => {
    if (!day || !onStart || starting.current) return
    starting.current = true
    setBusy(true)
    setError(null)
    try {
      await onStart(helpMessage(item, day, href))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not open a temporary chat. Try again.')
    } finally {
      starting.current = false
      setBusy(false)
    }
  }
  return (
    <HelpContext.Provider value={day && onStart ? { start, busy } : null}>
      {children}
      {error && (
        <div className="sky-undo sky-item-help-error" role="alert">
          <span>{error}</span>
          <Button size="compact-sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}
    </HelpContext.Provider>
  )
}

export function ItemHelpButton({ item, href, disabled }: { item: DayItem; href: string | null; disabled: boolean }) {
  const help = useContext(HelpContext)
  if (!help) return null
  return (
    <Tooltip label="Get Sky’s help" withArrow events={{ hover: true, focus: true, touch: false }}>
      <ActionIcon
        variant="primary-quiet"
        size={32}
        className="sky-item-help"
        aria-label="Get Sky’s help"
        disabled={disabled || help.busy}
        onClick={() => help.start(item, href)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
        </svg>
      </ActionIcon>
    </Tooltip>
  )
}
