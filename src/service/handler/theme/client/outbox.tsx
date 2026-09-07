import { ActionIcon, Button, Checkbox, Textarea } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeOutboxScan } from '#lib/outbox/describeScan.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { OutboxReport, OutboxScanResult } from '../../outbox/mod.ts'
import './outbox.css'

type Edit = { text: string; revision: string; saved: string }
// Going to another Sky page must not discard an unfinished edit.
const edits = new Map<string, Edit>()

async function request<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/outbox/_api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Outbox could not complete this step.')
  return body as T
}

function Pen() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" />
    </svg>
  )
}

function needsReview(item: OutboxRecord): boolean {
  return item.status !== 'ready' || item.stale
}

function sourceLink(item: OutboxRecord): string | null {
  const target = item.conversation.target
  if (!target) return null
  return target.medium === 'Slack'
    ? target.link
    : `https://mail.google.com/mail/u/${encodeURIComponent(target.account)}/#all/${target.thread}`
}

export function OutboxMain({ navigate }: { navigate: (path: string) => void }) {
  const [report, setReport] = useState<OutboxReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<OutboxScanResult | null>(null)
  const checkInFlight = useRef(false)
  const [tab, setTab] = useState<'review' | 'ready'>('review')
  const [selected, setSelected] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [reviewedChanges, setReviewedChanges] = useState(false)
  const [details, setDetails] = useState(true)
  const [voice, setVoice] = useState<{ text: string; revision: string } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const listPosition = useRef(0)
  const refresh = useCallback(async () => setReport(await request<OutboxReport>('/status')), [])
  useEffect(() => {
    let alive = true
    const read = () =>
      request<OutboxReport>('/status')
        .then((value) => {
          if (alive) setReport(value)
        })
        .catch((problem: Error) => {
          if (alive) setError(problem.message)
        })
    void read()
    window.addEventListener('focus', read)
    const timer = setInterval(read, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        [...edits.values()].some((value) => value.text !== value.saved) ||
        (voice?.text !== undefined && voice.text !== report?.preferences.text)
      )
        event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [voice, report?.preferences.text])
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = selected ? 0 : listPosition.current
  }, [selected])

  const item = report?.items.find((candidate) => candidate.id === selected)
  const reviewCount = report?.items.filter(needsReview).length ?? 0
  const readyCount = (report?.items.length ?? 0) - reviewCount
  const items = report?.items.filter((candidate) => (tab === 'review') === needsReview(candidate)) ?? []
  const open = (record: OutboxRecord) => {
    listPosition.current = scroll.current?.scrollTop ?? 0
    setSelected(record.id)
    if (window.matchMedia('(max-width: 1000px)').matches) setDetails(false)
    setEdit(edits.get(record.id) ?? { text: record.draft, revision: record.revision, saved: record.draft })
    setReviewedChanges(false)
    setError('')
  }
  const change = (text: string) => {
    if (!item || !edit) return
    const next = { ...edit, text }
    edits.set(item.id, next)
    setEdit(next)
  }
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Outbox could not complete this step.')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const checkNow = async () => {
    if (busy || checkInFlight.current) return
    checkInFlight.current = true
    setChecking(true)
    setBusy(true)
    setScanFeedback(null)
    try {
      const result = await request<OutboxScanResult>('/scan', 'POST', {})
      setScanFeedback({
        ...result,
        message:
          result.message ?? (result.outcome === 'failed' ? 'Sky could not complete this check.' : 'Check complete.'),
      })
    } catch (problem) {
      setScanFeedback({
        outcome: 'failed',
        message:
          problem instanceof TypeError
            ? 'Lost the connection to Sky. The check may still be running; refresh to see its result.'
            : problem instanceof Error
              ? problem.message
              : 'Sky could not complete this check.',
      })
    } finally {
      await refresh().catch(() => setError('Could not refresh Outbox. Reload the page to see its latest state.'))
      setChecking(false)
      setBusy(false)
      checkInFlight.current = false
    }
  }
  const save = () =>
    act(async () => {
      if (!item || !edit) return
      const result = await request<OutboxRecord>(`/item/${item.id}`, 'PUT', {
        revision: edit.revision,
        draft: edit.text,
      })
      edits.delete(item.id)
      setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
    })
  const approve = () =>
    act(async () => {
      if (!item || !edit) return
      const result = await request<OutboxRecord>(`/item/${item.id}/approve`, 'POST', {
        revision: edit.revision,
        draft: edit.text,
        reviewedChanges,
      })
      edits.delete(item.id)
      setEdit({ text: result.draft, revision: result.revision, saved: result.draft })
    })
  const dismiss = () =>
    act(async () => {
      if (!item) return
      await request(`/item/${item.id}/dismiss`, 'POST', { revision: edit?.revision ?? item.revision })
      edits.delete(item.id)
      setSelected(null)
      setEdit(null)
    })
  const conflicted = Boolean(item && edit && item.revision !== edit.revision)
  const placing = item?.status === 'placing' || item?.status === 'placement_unknown'
  const editable = item && (item.status === 'needs_review' || (item.stale && item.status === 'ready'))

  return (
    <div className="sky-main sky-outbox">
      <header className="sky-head">
        {selected && (
          <Button
            onClick={() => {
              setSelected(null)
              setEdit(null)
            }}
          >
            ‹ All decisions
          </Button>
        )}
        <span className="sky-title" data-focused={Boolean(selected)}>
          Outbox
        </span>
        <span className="sky-spacer" />
        <Button leftSection={<Pen />} onClick={() => setVoice(report?.preferences ?? null)}>
          Your voice
        </Button>
        {selected && (
          <ActionIcon aria-label={details ? 'Hide details' : 'Show details'} onClick={() => setDetails(!details)}>
            {details ? '›' : '‹'}
          </ActionIcon>
        )}
      </header>
      <div className="sky-outbox-layout">
        <div className="sky-scroll" ref={scroll}>
          <div className="sky-outbox-column">
            {error && (
              <div className="sky-outbox-notice" role="alert">
                {error}
              </div>
            )}
            {voice ? (
              <section className="sky-outbox-voice">
                <h2>Your voice</h2>
                <p>How you communicate, and how you want Sky to handle requests.</p>
                <Textarea
                  aria-label="Communication preferences"
                  autosize
                  minRows={7}
                  value={voice.text}
                  onChange={(event) => setVoice({ ...voice, text: event.currentTarget.value })}
                />
                <p className="sky-outbox-meta">
                  Sky uses your approved before-and-after drafts as examples. Facts from one conversation stay in that
                  conversation.
                </p>
                <div className="sky-outbox-actions">
                  <Button
                    variant="filled"
                    color="indigo"
                    loading={busy}
                    onClick={() =>
                      void act(async () => {
                        await request('/preferences', 'PUT', voice)
                        setVoice(null)
                      })
                    }
                  >
                    Save preferences
                  </Button>
                  <Button onClick={() => setVoice(null)}>Close</Button>
                </div>
              </section>
            ) : item && edit ? (
              <>
                <div className="sky-outbox-meta">
                  {item.conversation.medium} · {item.conversation.sources.at(-1)?.from}
                </div>
                <h1>{item.title}</h1>
                <p className="sky-outbox-situation">{item.situation}</p>
                {item.stale && (
                  <div className="sky-outbox-notice">
                    New messages arrived. Your draft is preserved; read the updated conversation before approving.
                  </div>
                )}
                {conflicted && (
                  <div className="sky-outbox-notice">
                    This decision changed while you were editing. Your text is preserved.
                    <Button
                      onClick={() => {
                        const next = { ...edit, revision: item.revision }
                        setEdit(next)
                        edits.set(item.id, next)
                        setReviewedChanges(false)
                      }}
                    >
                      Review latest context with my text
                    </Button>
                  </div>
                )}
                {item.questions.length > 0 && (
                  <div className="sky-outbox-questions">
                    <h3>Your decision</h3>
                    <ul>
                      {item.questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {item.conversation.limitations.map((limitation) => (
                  <p className="sky-outbox-meta" key={limitation}>
                    {limitation}
                  </p>
                ))}
                <section className="sky-outbox-draft">
                  <div className="sky-outbox-draft-label">
                    {editable ? 'Proposed reply' : item.status === 'ready' ? 'Ready in app' : 'Approved reply'}
                  </div>
                  {editable ? (
                    <Textarea
                      aria-label="Reply draft"
                      autosize
                      minRows={5}
                      value={edit.text}
                      onChange={(event) => change(event.currentTarget.value)}
                      disabled={busy}
                    />
                  ) : (
                    <p className="sky-outbox-text">{item.draft}</p>
                  )}
                </section>
                {item.stale && (
                  <Checkbox
                    checked={reviewedChanges}
                    onChange={(event) => setReviewedChanges(event.currentTarget.checked)}
                    label="I’ve reviewed the new messages"
                  />
                )}
                {placing && (
                  <div className="sky-outbox-notice">
                    {item.status === 'placing'
                      ? 'Saving your approved draft. If this was interrupted, check the native app before creating another.'
                      : 'Draft placement could not be confirmed. Check the native app; Sky will not retry automatically.'}
                    {item.placementError && <p>{item.placementError}</p>}
                  </div>
                )}
                <div className="sky-outbox-actions">
                  {editable && (
                    <Button
                      variant="filled"
                      color="indigo"
                      loading={busy}
                      disabled={
                        !edit.text.trim() || conflicted || (item.stale && !reviewedChanges) || !item.conversation.target
                      }
                      onClick={() => void approve()}
                    >
                      {item.native
                        ? 'Approve update in app'
                        : `Approve draft in ${item.conversation.medium === 'Email' ? 'Gmail' : 'Slack'}`}
                    </Button>
                  )}
                  {item.status === 'needs_review' && (
                    <Button disabled={busy || conflicted || edit.text === edit.saved} onClick={() => void save()}>
                      Save edit
                    </Button>
                  )}
                  {(item.native?.url || sourceLink(item)) && (
                    <Button component="a" href={item.native?.url ?? sourceLink(item)!} target="_blank" rel="noreferrer">
                      Open {item.conversation.medium === 'Email' ? 'Gmail' : 'Slack'} ↗
                    </Button>
                  )}
                  <Button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(edit.text)
                        .catch(() => setError('Could not copy the reply. Select the text to copy it.'))
                    }
                  >
                    Copy reply
                  </Button>
                  <Button disabled={busy || item.status === 'placing'} onClick={() => void dismiss()}>
                    {item.status === 'needs_review' ? 'Dismiss' : 'Archive'}
                  </Button>
                </div>
                <p className="sky-outbox-meta">
                  {item.status === 'ready'
                    ? 'Your draft is waiting in the app. You review and press Send there.'
                    : 'Approve here to place this wording in the app. You press Send there.'}
                </p>
                {item.originalDraft && item.originalDraft !== edit.text && (
                  <details className="sky-outbox-original">
                    <summary>Sky’s original draft</summary>
                    <p className="sky-outbox-text">{item.originalDraft}</p>
                  </details>
                )}
              </>
            ) : (
              <>
                <div className="sky-outbox-intro">
                  <h1>A few decisions. The rest, handled.</h1>
                  <p>Replies Sky has prepared for your review.</p>
                </div>
                <div className="sky-outbox-tabs" role="tablist" aria-label="Outbox stages">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'review'}
                    onClick={() => {
                      setTab('review')
                      listPosition.current = 0
                    }}
                  >
                    Needs review <span>{reviewCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'ready'}
                    onClick={() => {
                      setTab('ready')
                      listPosition.current = 0
                    }}
                  >
                    Ready in apps <span>{readyCount}</span>
                  </button>
                </div>
                {report === null ? (
                  <p>Loading Outbox…</p>
                ) : !report.automation ? (
                  <div className="sky-outbox-empty">
                    <h2>Let Sky prepare the replies.</h2>
                    <p>
                      Start with today’s saved Slack and email conversations. Sky will check new captures every five
                      minutes.
                    </p>
                    <Button
                      variant="filled"
                      color="indigo"
                      loading={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('/setup', 'POST', {})
                        })
                      }
                    >
                      Enable Outbox
                    </Button>
                  </div>
                ) : items.length === 0 ? (
                  <div className="sky-outbox-empty">
                    <h2>{tab === 'review' ? 'Nothing needs your review yet.' : 'Approved drafts will appear here.'}</h2>
                    <p>
                      {tab === 'review'
                        ? 'Sky will prepare useful replies as new conversations are saved.'
                        : 'Review a reply in Outbox to place it in its native app.'}
                    </p>
                  </div>
                ) : (
                  <div className="sky-outbox-list">
                    {items.map((record) => (
                      <button type="button" className="sky-outbox-row" key={record.id} onClick={() => open(record)}>
                        <span className="sky-outbox-avatar" aria-hidden="true">
                          {record.conversation.medium === 'Slack' ? '#' : '@'}
                        </span>
                        <span className="sky-outbox-row-content">
                          <span className="sky-outbox-meta">
                            {record.conversation.sources.at(-1)?.from} · {record.conversation.medium}
                          </span>
                          <strong>{record.title}</strong>
                          <span className="sky-outbox-situation">{record.situation}</span>
                          <span className="sky-outbox-preview" data-ready={!needsReview(record)}>
                            {edits.get(record.id)?.text ||
                              record.draft ||
                              record.questions[0] ||
                              'Your decision is needed.'}
                          </span>
                          <span className="sky-outbox-meta">
                            {record.stale
                              ? 'New messages · review again'
                              : record.status === 'ready'
                                ? 'Ready for you to send in the app'
                                : record.status === 'placement_unknown'
                                  ? 'Check draft placement in the app'
                                  : `${record.conversation.sources.length} saved ${record.conversation.sources.length === 1 ? 'message' : 'messages'}`}
                          </span>
                        </span>
                        <span className="sky-outbox-arrow" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {report?.automation && (
                  <div className="sky-outbox-footer">
                    <p>
                      Saved Slack and email conversations ·{' '}
                      {report.automation.status === 'paused' ? 'Paused' : 'Checks every 5 minutes'}
                      {report.lastScan ? ` · Last checked ${report.lastScan.at} UTC` : ''}
                    </p>
                    <p
                      className="sky-outbox-scan-feedback"
                      role={
                        !checking && (scanFeedback?.outcome ?? report.lastScan?.outcome) === 'failed'
                          ? 'alert'
                          : 'status'
                      }
                      aria-live={checking ? 'polite' : undefined}
                      aria-atomic="true"
                      data-checking={checking}
                    >
                      {checking
                        ? 'Checking saved Slack and email conversations…'
                        : (scanFeedback?.message ??
                          (report.lastScan
                            ? describeOutboxScan(report.lastScan)
                            : 'Ready to check your saved conversations.'))}
                    </p>
                    <div className="sky-outbox-actions">
                      <Button loading={checking} disabled={busy && !checking} onClick={() => void checkNow()}>
                        {checking ? 'Checking…' : 'Check now'}
                      </Button>
                      <Button onClick={() => navigate(`/automations/${report.automation!.name}`)}>
                        System automation
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {item && details && !voice && (
          <aside className="sky-outbox-details">
            <div className="sky-outbox-details-head">
              <ActionIcon aria-label="Hide details" onClick={() => setDetails(false)}>
                ›
              </ActionIcon>
              <strong>Details</strong>
            </div>
            <h3>Why this needs you</h3>
            <p>{item.reasoning}</p>
            <h3>Conversation</h3>
            {item.conversation.sources.map((source) => (
              <section key={source.ref}>
                <div className="sky-outbox-meta">
                  {source.ref.slice(0, 10)} · {source.from}
                </div>
                <p className="sky-outbox-text">{source.body}</p>
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
