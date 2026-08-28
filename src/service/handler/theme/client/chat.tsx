import { ActionIcon, Button, Textarea } from '@mantine/core'
import { Fragment, type KeyboardEvent, useCallback, useEffect, useReducer, useRef } from 'react'

/**
 * The live chat at `/` — a client of the service's /chat routes.
 *
 * It renders the same event stream the terminal renders, and nothing more:
 * the person's turns as bubbles, sky's reply streamed into the body as it
 * arrives, tool calls as chips. The one thing it shows that a terminal
 * can't show as well is the gather: the first reply waits while sky reads
 * the notebook, and that wait appears as a line in the record's own voice,
 * with the real counts, rather than a spinner.
 */

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** Notebook stamp `YYYY-MM-DD HH:MM` from the service, or a client clock */
  time?: string
  /** The reply rendered as HTML once it finished streaming */
  html?: string
  /** Tools the reply called, in order */
  tools?: string[]
  /** The gather that preceded this reply, kept as its provenance */
  note?: string
  error?: string
}

/** A line in the record's voice: what happened to the thread, not a message in it. */
interface Note {
  text: string
  tone: 'quiet' | 'done' | 'failed'
}

type Phase = 'idle' | 'busy' | 'saving'

interface ThreadState {
  id: string
  turns: Turn[]
  notes: Note[]
  phase: Phase
  /** The gather line while it runs; attaches to the reply once text arrives */
  gather: string | null
  /** Files in context after the last rebuild */
  documents: number | null
}

type Action =
  | { type: 'loaded'; id: string; turns: Turn[]; documents: number | null }
  | { type: 'fresh'; id: string }
  | { type: 'sent'; content: string }
  | { type: 'gather'; text: string; documents?: number }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'finished'; text: string; sources: string[] }
  | { type: 'failed'; message: string }
  | { type: 'rendered'; index: number; html: string }
  | { type: 'saving' }
  | { type: 'note'; note: Note }

const STORAGE_KEY = 'sky.chat.thread'

function clock(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Ensure the turn being written is the reply, creating it on the first sign of one. */
function withReply(turns: Turn[], edit: (reply: Turn) => Turn): Turn[] {
  const last = turns.at(-1)
  if (last?.role === 'assistant') return [...turns.slice(0, -1), edit(last)]
  return [...turns, edit({ role: 'assistant', content: '', time: clock() })]
}

function reduce(state: ThreadState, action: Action): ThreadState {
  switch (action.type) {
    case 'loaded':
      return { ...state, id: action.id, turns: action.turns, documents: action.documents, notes: [], phase: 'idle' }
    case 'fresh':
      return { ...state, id: action.id, turns: [], gather: null, documents: null, phase: 'idle' }
    case 'sent':
      return {
        ...state,
        phase: 'busy',
        notes: state.turns.length === 0 ? [] : state.notes,
        gather: state.turns.length === 0 ? 'reading your notebook' : null,
        turns: [...state.turns, { role: 'user', content: action.content, time: clock() }],
      }
    case 'gather':
      return { ...state, gather: action.text, documents: action.documents ?? state.documents }
    case 'delta': {
      const note = state.gather ?? undefined
      return {
        ...state,
        gather: null,
        turns: withReply(state.turns, (r) => ({ ...r, content: r.content + action.text, note: r.note ?? note })),
      }
    }
    case 'tool':
      return { ...state, turns: withReply(state.turns, (r) => ({ ...r, tools: [...(r.tools ?? []), action.name] })) }
    case 'finished': {
      const content = action.sources.length
        ? `${action.text}\n\nSources:\n${action.sources.map((u) => `- ${u}`).join('\n')}`
        : action.text
      return {
        ...state,
        phase: 'idle',
        gather: null,
        turns: withReply(state.turns, (r) => ({ ...r, content, note: r.note ?? state.gather ?? undefined })),
      }
    }
    case 'failed':
      return {
        ...state,
        phase: 'idle',
        gather: null,
        turns: withReply(state.turns, (r) => ({ ...r, error: action.message })),
      }
    case 'rendered':
      return { ...state, turns: state.turns.map((t, i) => (i === action.index ? { ...t, html: action.html } : t)) }
    case 'saving':
      return { ...state, phase: 'saving' }
    case 'note':
      return { ...state, notes: [...state.notes, action.note] }
  }
}

// -----------------------------------------------------------------------------
// The wire
// -----------------------------------------------------------------------------

interface Frame {
  event: string
  data: Record<string, unknown>
}

/** Frames off a streaming response, as they complete. */
async function* frames(response: Response): AsyncGenerator<Frame> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const raw = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      yield { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} }
      end = buffer.indexOf('\n\n')
    }
  }
}

async function renderMarkdown(raw: string): Promise<string | null> {
  try {
    const response = await fetch('/docs/_api/render-block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, type: 'markdown' }),
    })
    if (!response.ok) return null
    return ((await response.json()) as { html: string }).html
  } catch {
    return null
  }
}

function humanize(toolName: string): string {
  return toolName.replaceAll('_', ' ')
}

// -----------------------------------------------------------------------------
// The hook — everything the shell needs to drive a thread
// -----------------------------------------------------------------------------

export function useChat() {
  const [state, dispatch] = useReducer(reduce, {
    id: '',
    turns: [],
    notes: [],
    phase: 'idle',
    gather: null,
    documents: null,
  })

  const fresh = useCallback(() => {
    const id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
    dispatch({ type: 'fresh', id })
  }, [])

  // A reload picks the thread back up from the service; a thread the
  // service no longer holds (it restarted) starts over.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      fresh()
      return
    }
    fetch(`/chat/${saved}`)
      .then(async (response) => {
        if (!response.ok) return fresh()
        const body = (await response.json()) as {
          turns: Array<{ role: 'user' | 'assistant'; content: string; when?: string }>
          documents: number
          kept: number | null
        }
        const turns: Turn[] = body.turns.map((t) => ({ role: t.role, content: t.content, time: t.when?.slice(11) }))
        dispatch({ type: 'loaded', id: saved, turns, documents: body.kept ?? body.documents })
        turns.forEach((t, index) => {
          if (t.role === 'assistant')
            renderMarkdown(t.content).then((html) => html && dispatch({ type: 'rendered', index, html }))
        })
      })
      .catch(fresh)
  }, [fresh])

  const send = useCallback(
    async (content: string) => {
      const message = content.trim()
      if (!message || state.phase !== 'idle') return
      dispatch({ type: 'sent', content: message })
      const replyIndex = state.turns.length + 1

      let response: Response
      try {
        response = await fetch(`/chat/${state.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
      } catch {
        dispatch({ type: 'failed', message: "Couldn't reach sky — is the service running?" })
        return
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        dispatch({ type: 'failed', message: body.message ?? `The service answered ${response.status}.` })
        return
      }

      let finished = false
      for await (const frame of frames(response)) {
        const d = frame.data
        switch (frame.event) {
          case 'session-started':
            dispatch({
              type: 'gather',
              text: `reading your notebook · ${d.documents} files`,
              documents: d.documents as number,
            })
            break
          case 'context-gathering':
            dispatch({ type: 'gather', text: 'finding what matters for this' })
            break
          case 'context-rebuilt': {
            const report = d.report as { collectionSize: number; stats?: { kept: number } }
            const kept = report.stats ? ` · ${report.stats.kept} in context` : ''
            dispatch({
              type: 'gather',
              text: `${report.collectionSize} files read${kept}`,
              documents: report.stats?.kept ?? report.collectionSize,
            })
            break
          }
          case 'text-delta':
            dispatch({ type: 'delta', text: d.text as string })
            break
          case 'tool-call':
            dispatch({ type: 'tool', name: humanize(d.toolName as string) })
            break
          case 'turn': {
            finished = true
            if (typeof d.error === 'string') {
              dispatch({ type: 'failed', message: d.error })
            } else {
              const text = d.text as string
              const sources = (d.sourceUrls as string[]) ?? []
              dispatch({ type: 'finished', text, sources })
              renderMarkdown(text).then((html) => html && dispatch({ type: 'rendered', index: replyIndex, html }))
            }
            break
          }
          case 'error':
            finished = true
            dispatch({ type: 'failed', message: d.message as string })
            break
        }
      }
      if (!finished) dispatch({ type: 'failed', message: 'The connection closed before the reply finished.' })
    },
    [state.id, state.phase, state.turns.length],
  )

  // Ending a thread files it through the same gate as ai:chat and starts
  // the next one. Every write the save makes to the machine-owned stores
  // is shown — silence means nothing was written.
  const saveAndClose = useCallback(async () => {
    if (state.phase !== 'idle') return
    if (state.turns.length === 0) return fresh()
    dispatch({ type: 'saving' })
    try {
      const response = await fetch(`/chat/${state.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        dispatch({
          type: 'note',
          note: { text: `Couldn't save — ${body.message ?? response.status}. Try again.`, tone: 'failed' },
        })
        dispatch({ type: 'fresh', id: state.id })
        return
      }
      const { saved } = (await response.json()) as {
        saved: {
          summary: string
          exchanges: number
          aborted?: { reason: string }
          memoryOps?: Array<{ op: string; summary: string; outcome: string }>
          personOps?: Array<{ op?: string; summary?: string; name?: string; outcome?: string }>
        } | null
      }
      const notes: Note[] = []
      if (!saved) notes.push({ text: 'Nothing to save', tone: 'quiet' })
      else if (saved.aborted)
        notes.push({ text: `Not saved — ${saved.aborted.reason}. A recovery copy was written.`, tone: 'failed' })
      else
        notes.push({
          text: `Saved as “${saved.summary}” · ${saved.exchanges} turn${saved.exchanges === 1 ? '' : 's'}`,
          tone: 'done',
        })
      for (const m of saved?.memoryOps ?? []) {
        if (m.outcome !== 'skipped') notes.push({ text: `🧠 ${m.op}: ${m.summary}`, tone: 'quiet' })
      }
      for (const p of saved?.personOps ?? []) {
        if (p.outcome !== 'skipped')
          notes.push({ text: `👤 ${p.op ?? 'updated'}: ${p.summary ?? p.name ?? ''}`, tone: 'quiet' })
      }
      fresh()
      for (const note of notes) dispatch({ type: 'note', note })
    } catch {
      dispatch({ type: 'note', note: { text: "Couldn't reach sky — is the service running?", tone: 'failed' } })
      dispatch({ type: 'fresh', id: state.id })
    }
  }, [state.id, state.phase, state.turns.length, fresh])

  return { state, send, saveAndClose }
}

// -----------------------------------------------------------------------------
// The main column
// -----------------------------------------------------------------------------

export function ChatMain({ chat }: { chat: ReturnType<typeof useChat> }) {
  const { state, send, saveAndClose } = chat
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Follow the reply as it streams, unless the reader scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [state.turns, state.gather])

  const submit = () => {
    const el = inputRef.current
    if (!el) return
    const text = el.value
    el.value = ''
    void send(text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const title = state.turns
    .find((t) => t.role === 'user')
    ?.content.split(/\s+/)
    .slice(0, 8)
    .join(' ')
  const busy = state.phase !== 'idle'
  const empty = state.turns.length === 0 && state.notes.length === 0 && !state.gather

  return (
    <div className="sky-main">
      <header className="sky-head">
        <span className="sky-title">{title ?? 'New chat'}</span>
        <nav className="sky-tabs">
          {state.turns.length > 0 && (
            <Button size="sm" onClick={saveAndClose} disabled={busy}>
              {state.phase === 'saving' ? 'Saving…' : 'Save & close'}
            </Button>
          )}
        </nav>
      </header>

      <div className="sky-scroll" ref={scrollRef}>
        {empty ? (
          <div className="sky-blank">
            <p>Ask about your notebook. Answers come from your files.</p>
          </div>
        ) : (
          <div className="sky-col">
            {state.notes.map((note, i) => (
              <div key={`n${i}`} className="sky-condensed" data-tone={note.tone}>
                — {note.text} —
              </div>
            ))}
            {state.turns.map((turn, i) => (
              <Fragment key={i}>
                <TurnView turn={turn} streaming={busy && i === state.turns.length - 1 && turn.role === 'assistant'} />
              </Fragment>
            ))}
            {state.gather && <div className="sky-condensed">— {state.gather} —</div>}
            {state.phase === 'saving' && <div className="sky-condensed">— saving —</div>}
          </div>
        )}
      </div>

      <div className="sky-composer-zone">
        <div className="sky-composer">
          <div className="sky-input">
            <Textarea
              ref={inputRef}
              variant="unstyled"
              classNames={{ root: 'sky-input-root', input: 'sky-input-field' }}
              autosize
              minRows={1}
              maxRows={8}
              placeholder="Message sky…"
              aria-label="Message sky"
              onKeyDown={onKeyDown}
              disabled={busy}
              autoFocus
            />
          </div>
          <ActionIcon variant="light" color="blue" aria-label="Send" onClick={submit} disabled={busy}>
            ↑
          </ActionIcon>
        </div>
        <div className="sky-under">
          <span className="sky-hint">Enter to send</span>
          <span className="sky-hint">·</span>
          <span className="sky-hint">Shift+Enter for a new line</span>
          {state.documents !== null && (
            <>
              <span className="sky-hint">·</span>
              <span>{state.documents} files in context</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TurnView({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  if (turn.role === 'user') {
    return (
      <div className="sky-turn sky-turn-user">
        <div className="sky-bubble">{turn.content}</div>
      </div>
    )
  }

  return (
    <>
      {turn.note && <div className="sky-condensed">— {turn.note} —</div>}
      <div className="sky-turn">
        <span className="sky-who">sky{turn.time ? ` · ${turn.time}` : ''}</span>
        {turn.html ? (
          <div className="sky-body sky-rendered" dangerouslySetInnerHTML={{ __html: turn.html }} />
        ) : (
          <div className="sky-body">
            {turn.content.split(/\n{2,}/).map((para, i, all) => (
              <p key={i} className="sky-para">
                {para}
                {streaming && i === all.length - 1 && <span className="sky-caret" aria-hidden="true" />}
              </p>
            ))}
            {streaming && turn.content === '' && (
              <p className="sky-para">
                <span className="sky-caret" aria-hidden="true" />
              </p>
            )}
          </div>
        )}
        {turn.tools && turn.tools.length > 0 && (
          <div className="sky-chips">
            {turn.tools.map((tool, i) => (
              <span key={i} className="sky-chip" data-act="true">
                {tool}
              </span>
            ))}
          </div>
        )}
        {turn.error && <span className="sky-fate">turn failed — {turn.error}</span>}
      </div>
    </>
  )
}
