import { Button, TextInput } from '@mantine/core'
import { Fragment, type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { humanize } from './chat.tsx'
import { fileHref } from './explorer.tsx'

/**
 * What sky read — the thread's context as a story, and the hand on it.
 *
 * The stream tells the thread how many files are in context; this panel
 * tells how they got there, turn by turn: the notebook read at the start,
 * what later questions brought in, what the budget pushed out to make
 * room, what the model read by tool, and the step under way while a reply
 * is prepared. Below the story sits what the model sees now — every
 * document with its tokens, what was left out and why — and three moves:
 * pin a document in (any file, by path), keep one out, or let one go.
 * Every move reassembles the context at once, so the list is always what
 * the next message will be answered from.
 */

export interface ContextDoc {
  path: string
  tokens: number
  score?: number
  pinned?: true
  cut?: string
  via?: 'reserve'
}

export interface TurnStats {
  kept: number
  pruned: number
  excluded: number
  docTokens: number
  budget?: number
  reused?: boolean
}

export interface ToolCall {
  tool: string
  input?: string
  outcome: 'ok' | 'error' | 'denied'
  tokens?: number
}

/** One turn of the story — mirrors handler/chat/timeline.ts. */
export interface TimelineEntry {
  turn: number
  when: string | null
  kind: 'seed' | 'grew' | 'same' | 'closed' | 'failed'
  searches: number
  stats?: TurnStats
  found?: number
  added: ContextDoc[]
  pushedOut: ContextDoc[]
  tools: ToolCall[]
  errors: string[]
}

export interface ThreadContext {
  turn: number
  documents: number
  stats: TurnStats | null
  kept: ContextDoc[]
  cut: ContextDoc[]
  log: TimelineEntry[]
}

export type ContextAction = 'pin' | 'exclude' | 'release'

/** The thread's context, re-read whenever the thread's turn count or context version moves. */
export function useThreadContext(id: string, version: number, open: boolean) {
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
          const body = (await r.json().catch(() => ({}))) as { message?: string }
          setNote(body.message ?? `The service answered ${r.status}.`)
        }
      })
      .catch(() => alive && setNote("Couldn't reach sky — is the service running?"))
    return () => {
      alive = false
    }
  }, [id, version, open])

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

export function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

function split(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  const file = slash >= 0 ? path.slice(slash + 1) : path
  return { name: file.replace(/\.md$/, ''), dir: slash >= 0 ? path.slice(0, slash) : '' }
}

// -----------------------------------------------------------------------------
// The story
// -----------------------------------------------------------------------------

/** One document in a turn's change: came in, or was pushed out. */
function ChangeRow({ doc, mark }: { doc: ContextDoc; mark: 'add' | 'cut' }) {
  const { name, dir } = split(doc.path)
  const tag = mark === 'add' ? (doc.cut ? "didn't fit" : doc.pinned ? 'pinned' : null) : null
  return (
    <div className="sky-tl-row" data-cut={mark === 'cut' || Boolean(doc.cut)}>
      <span className="sky-tl-mark" data-k={mark}>
        {mark === 'add' ? '+' : '−'}
      </span>
      <span className="sky-tl-doc">
        <span className="sky-tl-name">
          <a href={fileHref(doc.path)}>{name}</a>
        </span>
        {dir && <span className="sky-tl-dir">{dir}</span>}
      </span>
      {tag && <span className="sky-tag">{tag}</span>}
      <span className="sky-ctx-tok">{tokens(doc.tokens)}</span>
    </div>
  )
}

/** One tool the model called during the turn — what it reached for, and what came back. */
function ToolRow({ call }: { call: ToolCall }) {
  return (
    <div className="sky-tl-row">
      <span className="sky-tl-mark"></span>
      <span className="sky-tl-doc">
        <span className="sky-chip sky-chip-sm" data-act="true">
          {humanize(call.tool)}
        </span>
        {call.input && <span className="sky-tl-dir">{call.input}</span>}
      </span>
      {call.outcome !== 'ok' && <span className="sky-tag">{call.outcome}</span>}
      {call.tokens !== undefined && <span className="sky-ctx-tok">{tokens(call.tokens)}</span>}
    </div>
  )
}

function budgetLine(stats: TurnStats): string {
  return stats.budget ? `${tokens(stats.docTokens)} of ${tokens(stats.budget)}` : tokens(stats.docTokens)
}

function Entry({ entry, last }: { entry: TimelineEntry; last: boolean }) {
  const stats = entry.stats
  let title: string
  let line: string | null = null
  let tone: 'done' | 'quiet' | 'failed' = 'done'
  switch (entry.kind) {
    case 'seed':
      title = 'Read your notebook'
      if (stats) line = `${entry.found ?? 0} files found · ${stats.kept} fit · ${budgetLine(stats)}`
      break
    case 'grew':
      title = entry.added.length > 0 ? 'Looked for more' : 'Looked again'
      if (entry.added.length === 0) line = 'Nothing new'
      break
    case 'same':
      title = 'Nothing new'
      tone = 'quiet'
      if (stats) line = `Same ${stats.kept} files`
      break
    case 'closed':
      title = 'Notebook closed'
      tone = 'quiet'
      line = 'Nothing read'
      break
    case 'failed':
      title = "Couldn't gather"
      tone = 'failed'
      break
  }
  const searches =
    entry.searches > 0 && entry.kind !== 'seed'
      ? `${entry.searches} new search${entry.searches === 1 ? '' : 'es'}`
      : null

  return (
    <div className="sky-tl-entry">
      <div className="sky-tl-rail">
        <span className="sky-dot" data-tone={tone === 'failed' ? 'failed' : tone === 'quiet' ? undefined : 'done'} />
        {!last && <span className="sky-tl-line" />}
      </div>
      <div>
        <div className="sky-tl-head" data-tone={tone}>
          <span className="sky-tl-when">{entry.when ?? ''}</span>
          <span>{title}</span>
        </div>
        {line && <div className="sky-tl-txt">{line}</div>}
        {searches && <div className="sky-tl-sub">{searches}</div>}
        {entry.errors.map((error, i) => (
          <div key={i} className="sky-tl-fate">
            {error}
          </div>
        ))}
        {entry.added.length > 0 && (
          <>
            <div className="sky-tl-label">Added {entry.added.length}</div>
            {entry.added.map((doc) => (
              <Fragment key={doc.path}>
                <ChangeRow doc={doc} mark="add" />
              </Fragment>
            ))}
          </>
        )}
        {entry.pushedOut.length > 0 && (
          <>
            <div className="sky-tl-label">Pushed out by budget · {entry.pushedOut.length}</div>
            {entry.pushedOut.map((doc) => (
              <Fragment key={doc.path}>
                <ChangeRow doc={doc} mark="cut" />
              </Fragment>
            ))}
          </>
        )}
        {entry.tools.length > 0 && (
          <>
            <div className="sky-tl-label">Also used</div>
            {entry.tools.map((call, i) => (
              <Fragment key={i}>
                <ToolRow call={call} />
              </Fragment>
            ))}
          </>
        )}
        {entry.kind === 'grew' && stats && (
          <div className="sky-tl-sub" style={{ marginTop: 6 }}>
            {stats.kept} in · {budgetLine(stats)}
          </div>
        )}
      </div>
    </div>
  )
}

/** The turns so far, oldest first, and the step under way while a reply is prepared. */
function Timeline({ log, live }: { log: TimelineEntry[]; live: string | null }) {
  return (
    <div className="sky-tl">
      {log.map((entry, i) => (
        <Fragment key={entry.turn}>
          <Entry entry={entry} last={!live && i === log.length - 1} />
        </Fragment>
      ))}
      {live && (
        <div className="sky-tl-entry">
          <div className="sky-tl-rail">
            <span className="sky-dot" data-tone="live" />
          </div>
          <div className="sky-tl-head">
            <span className="sky-tl-when">now</span>
            <span>{live}…</span>
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// What the model sees now
// -----------------------------------------------------------------------------

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
        <a href={fileHref(doc.path)}>{name}</a>
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
  version,
  busy,
  live,
  onClose,
}: {
  id: string
  /** Moves whenever the thread's context may have changed — the panel re-reads on it */
  version: number
  busy: boolean
  /** The step under way while a reply is prepared, or null between turns */
  live: string | null
  onClose: () => void
}) {
  const { context, note, act } = useThreadContext(id, version, true)
  const [now, setNow] = useState(false)
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
        {context && stats && (
          <span className="sky-mini">
            {context.kept.length} in · {context.cut.length} out · {budgetLine(stats)}
          </span>
        )}
        <Button size="compact-sm" onClick={onClose} aria-label="Close context">
          ×
        </Button>
      </div>

      {note && !live && <div className="sky-condensed">— {note} —</div>}

      {(context || live) && <Timeline log={context?.log ?? []} live={live} />}

      {context && (
        <>
          <div className="sky-panel-label sky-now">
            What sky sees now
            <span className="sky-mini">
              {context.kept.length} in · {context.cut.length} out
            </span>
            <button type="button" className="sky-more" onClick={() => setNow((open) => !open)}>
              {now ? 'Hide' : 'Show'}
            </button>
          </div>

          {now && (
            <>
              <TextInput
                size="sm"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                placeholder="Filter by path…"
                className="sky-panel-filter"
              />
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
