import { Button, TextInput } from '@mantine/core'
import { Fragment, type KeyboardEvent, useCallback, useEffect, useState } from 'react'

/**
 * What sky read — the thread's context, by document, and the hand on it.
 *
 * The stream tells the thread how many files are in context; this panel
 * lists them: what the model saw last rebuild with its tokens, what was
 * left out and why, and three moves — pin a document in (any file, by
 * path), keep one out, or let one go. Every move reassembles the context
 * at once, so the list is always what the next message will be answered
 * from.
 */

export interface ContextDoc {
  path: string
  tokens: number
  score?: number
  pinned?: true
  cut?: string
  via?: 'reserve'
}

export interface ThreadContext {
  turn: number
  documents: number
  stats: { kept: number; pruned: number; excluded: number; docTokens: number; budget?: number } | null
  kept: ContextDoc[]
  cut: ContextDoc[]
}

export type ContextAction = 'pin' | 'exclude' | 'release'

export function useThreadContext(id: string, turns: number, open: boolean) {
  const [context, setContext] = useState<ThreadContext | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    fetch(`/chat/${id}/context`)
      .then(async (r) => {
        if (!alive) return
        if (r.ok) {
          setContext((await r.json()) as ThreadContext)
          setNote(null)
        } else {
          setContext(null)
          setNote(
            r.status === 404 ? 'No context yet — the first message builds it.' : `The service answered ${r.status}.`,
          )
        }
      })
      .catch(() => alive && setNote("Couldn't reach sky — is the service running?"))
    return () => {
      alive = false
    }
  }, [id, turns, open])

  const act = useCallback(
    async (action: ContextAction, path: string) => {
      const r = await fetch(`/chat/${id}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, path }),
      }).catch(() => null)
      if (!r) return setNote("Couldn't reach sky — is the service running?")
      if (r.ok) {
        setContext((await r.json()) as ThreadContext)
        setNote(null)
      } else {
        const body = (await r.json().catch(() => ({}))) as { message?: string }
        setNote(body.message ?? `The service answered ${r.status}.`)
      }
    },
    [id],
  )

  return { context, note, act }
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

function split(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  const file = slash >= 0 ? path.slice(slash + 1) : path
  return { name: file.replace(/\.md$/, ''), dir: slash >= 0 ? path.slice(0, slash) : '' }
}

function DocRow({
  doc,
  busy,
  onAct,
}: {
  doc: ContextDoc
  busy: boolean
  onAct: (action: ContextAction, path: string) => void
}) {
  const { name, dir } = split(doc.path)
  const tag = doc.cut ?? (doc.pinned ? 'pinned' : doc.via)
  const byHand = doc.cut === 'excluded by you'
  return (
    <div className="sky-ctx-row" data-cut={Boolean(doc.cut)}>
      <span className="sky-ctx-txt">
        <a href={`/docs/${doc.path}`}>{name}</a>
        {dir && <span className="sky-ctx-dir">{dir}</span>}
      </span>
      <span className="sky-ctx-tok">{tokens(doc.tokens)}</span>
      {tag && <span className="sky-tag">{tag}</span>}
      <span className="sky-ctx-acts">
        {doc.cut ? (
          <Button size="compact-sm" disabled={busy} onClick={() => onAct(byHand ? 'release' : 'pin', doc.path)}>
            {byHand ? 'Let back' : 'Pin'}
          </Button>
        ) : (
          <>
            <Button size="compact-sm" disabled={busy} onClick={() => onAct(doc.pinned ? 'release' : 'pin', doc.path)}>
              {doc.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button size="compact-sm" disabled={busy} onClick={() => onAct('exclude', doc.path)}>
              Drop
            </Button>
          </>
        )}
      </span>
    </div>
  )
}

const SHOW = 40

function Rows({
  docs,
  busy,
  onAct,
}: {
  docs: ContextDoc[]
  busy: boolean
  onAct: (a: ContextAction, p: string) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all || docs.length <= SHOW + 5 ? docs : docs.slice(0, SHOW)
  return (
    <>
      {shown.map((doc) => (
        <Fragment key={doc.path}>
          <DocRow doc={doc} busy={busy} onAct={onAct} />
        </Fragment>
      ))}
      {shown.length < docs.length && (
        <button type="button" className="sky-more" onClick={() => setAll(true)}>
          Show all {docs.length}
        </button>
      )}
    </>
  )
}

export function ContextPanel({
  id,
  turns,
  busy,
  onClose,
}: {
  id: string
  turns: number
  busy: boolean
  onClose: () => void
}) {
  const { context, note, act } = useThreadContext(id, turns, true)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState('')

  const match = (doc: ContextDoc) => !filter || doc.path.toLowerCase().includes(filter.toLowerCase())
  const kept = context?.kept.filter(match) ?? []
  // The person's own exclusions first: what they did must be the first thing they see.
  const cut = (context?.cut.filter(match) ?? []).toSorted(
    (a, b) => Number(b.cut === 'excluded by you') - Number(a.cut === 'excluded by you'),
  )
  const stats = context?.stats

  const add = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !adding.trim()) return
    e.preventDefault()
    void act('pin', adding.trim()).then(() => setAdding(''))
  }

  return (
    <aside className="sky-panel">
      <div className="sky-panel-head">
        <span className="sky-panel-title">Context</span>
        {stats && (
          <span className="sky-mini">
            {stats.kept} in · {stats.pruned + stats.excluded} out · {tokens(stats.docTokens)} tokens
          </span>
        )}
        <Button size="compact-sm" onClick={onClose} aria-label="Close context">
          ×
        </Button>
      </div>

      {context && (
        <TextInput
          size="sm"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          placeholder="Filter by path…"
          className="sky-panel-filter"
        />
      )}

      {note && <div className="sky-condensed">— {note} —</div>}

      {context && (
        <>
          <div className="sky-panel-label">
            In context <span className="sky-mini">{kept.length}</span>
          </div>
          {kept.length === 0 && <div className="sky-ctx-empty">Nothing{filter ? ' matches' : ' in context'}.</div>}
          <Rows docs={kept} busy={busy} onAct={act} />

          {cut.length > 0 && (
            <>
              <div className="sky-panel-label">
                Left out <span className="sky-mini">{cut.length}</span>
              </div>
              <Rows docs={cut} busy={busy} onAct={act} />
            </>
          )}

          <div className="sky-panel-label">Pin a file</div>
          <TextInput
            size="sm"
            value={adding}
            onChange={(e) => setAdding(e.currentTarget.value)}
            onKeyDown={add}
            disabled={busy}
            placeholder="path/in/your/notebook.md — Enter to pin"
          />
        </>
      )}
    </aside>
  )
}
