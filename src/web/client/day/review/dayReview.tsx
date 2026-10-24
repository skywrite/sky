import './dayReview.css'
import { Button, Drawer, Modal, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import type { ReviewItem, ReviewJob, ReviewView } from '../../../../service/handler/day/review/types.ts'
import type { MeetingImport } from '../../import/import.tsx'

const api = '/day-review/_api'
export async function reviewRequest<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${api}/${route}`,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        },
  ).catch(() => {
    throw new Error('Sky did not answer. Refresh the review to check what saved, then try again.')
  })
  const value = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(value.message ?? 'The review could not be saved. Try again.')
  return value
}

/** One tab claims the return prompt; dismissing it does not cause another tab to show it. */
export function useReviewPrompt(open: (day: string) => void, showing: boolean) {
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (showing) return
    let alive = true,
      checking = false
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return
      checking = true
      try {
        const status = await reviewRequest<{ pending: string | null }>('status')
        if (status.pending && alive) {
          const claim = await reviewRequest<{ day: string | null }>('claim', {})
          if (claim.day && alive) openRef.current(claim.day)
        }
      } catch {
        /* A disconnected service must not interrupt another screen. */
      } finally {
        checking = false
      }
    }
    void check()
    const timer = window.setInterval(() => {
      void check()
    }, 15_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [showing])
}

function Job({ job, retry, busy }: { key?: string; job: ReviewJob; retry: () => void; busy: boolean }) {
  return (
    <div className="sky-review-job">
      <span aria-hidden="true">{job.status === 'done' ? '✓' : job.status === 'error' ? '!' : '·'}</span>
      <div>
        <strong>{job.title}</strong>
        <span className="sky-review-detail">
          {job.status === 'running'
            ? 'Running…'
            : job.status === 'waiting'
              ? 'Waiting'
              : (job.message ?? (job.status === 'done' ? 'Ready' : ''))}
        </span>
      </div>
      {job.status === 'error' && (
        <Button size="compact-sm" loading={busy} onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )
}

function TrackingAnswers({
  item,
  day,
  initial,
  onDraft,
  onSave,
  busy,
}: {
  key?: string
  item: ReviewItem
  day: string
  initial: Record<string, string>
  onDraft: (values: Record<string, string>) => void
  onSave: (values: Record<string, string>) => void
  busy: boolean
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const writes = useRef(Promise.resolve())
  const edit = (name: string, value: string) => {
    const next = { ...values, [name]: value }
    setValues(next)
    onDraft(next)
    writes.current = writes.current.then(async () => {
      try {
        await reviewRequest(`${day}/draft`, { id: item.id, values: next })
        setError(null)
      } catch {
        setError('This draft has not saved. Keep this review open and try again.')
      }
    })
  }
  return (
    <div className="sky-review-fields">
      {item.tracker?.columns.map((column) => (
        <TextInput
          key={column.name}
          label={`${column.name}${column.unit ? ` (${column.unit})` : ''}`}
          value={values[column.name] ?? ''}
          disabled={busy || Boolean(item.blocked)}
          onChange={(event) => edit(column.name, event.currentTarget.value)}
        />
      ))}
      {error && <p role="alert">{error}</p>}
      <Button variant="secondary" loading={busy} disabled={Boolean(item.blocked)} onClick={() => onSave(values)}>
        Save for {day}
      </Button>
    </div>
  )
}

export function DayReviewDialog({
  day,
  onClose,
  onChanged,
  navigate,
  onImportMeeting,
}: {
  key?: string
  day: string
  onClose: () => void
  onChanged: () => void
  navigate: (href: string) => void
  onImportMeeting: (files: File[], meeting: MeetingImport) => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [view, setView] = useState<ReviewView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const closing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const importMeeting = useRef<ReviewItem['meeting']>(undefined)
  const generation = useRef(0)
  const drafts = useRef<Record<string, Record<string, string>>>({})
  useEffect(() => {
    const title = `sky · Review ${day}`
    let previous = document.title
    const observer = new MutationObserver(() => {
      if (document.title !== title) {
        previous = document.title
        document.title = title
      }
    })
    const element = document.querySelector('title')
    if (element) observer.observe(element, { childList: true, subtree: true, characterData: true })
    document.title = title
    return () => {
      observer.disconnect()
      document.title = previous
    }
  }, [day])
  useEffect(() => {
    let alive = true
    const read = async (open: boolean) => {
      const version = generation.current
      try {
        const fresh = await reviewRequest<ReviewView>(open ? `${day}/open` : day, open ? {} : undefined)
        if (alive && !closing.current && version === generation.current) {
          setView(fresh)
          if (open) setError(null)
        }
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void read(true)
    const interval = window.setInterval(() => {
      void read(false)
    }, 4000)
    const pause = () => {
      void reviewRequest(`${day}/close`, {}).catch(() => {})
    }
    window.addEventListener('pagehide', pause)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener('pagehide', pause)
      if (!closing.current) pause()
    }
  }, [day])
  const run = async (id: string, action: () => Promise<ReviewView>) => {
    generation.current++
    setBusy(id)
    setError(null)
    try {
      const fresh = await action()
      setView(fresh)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      generation.current++
      setBusy(null)
    }
  }
  const answer = (item: ReviewItem, action: 'skip' | 'apply', values?: Record<string, string>) =>
    run(item.id, () => reviewRequest(`${day}/answer`, { id: item.id, action, values }))
  const close = async (after = onClose) => {
    closing.current = true
    try {
      await reviewRequest(`${day}/close`, {})
      onChanged()
      after()
    } catch (e) {
      closing.current = false
      setError(`Could not save the pause: ${(e as Error).message}`)
    }
  }
  const openSource = (href: string) => {
    void close(() => navigate(href))
  }
  const carry = view?.items.filter((item) => item.kind === 'carry') ?? []
  const movable = carry.filter((item) => !item.blocked)
  const moveAll = () =>
    run('carry', () => reviewRequest(`${day}/move`, { ids: movable.slice(0, 100).map((item) => item.id) }))
  const section = (kind: ReviewItem['kind'], title: string) => {
    const items = view?.items.filter((item) => item.kind === kind) ?? []
    if (!items.length) return null
    return (
      <section className="sky-review-section">
        <h3>{title}</h3>
        {kind === 'carry' && (
          <div className="sky-review-carry">
            <p>Move these unfinished todos and reminders to {view?.today}.</p>
            <Button
              variant="primary"
              disabled={Boolean(busy) || !movable.length}
              loading={busy === 'carry'}
              onClick={moveAll}
            >
              Move to today{movable.length ? ` (${movable.length})` : ''}
            </Button>
          </div>
        )}
        {items.map((item) => (
          <div className="sky-review-item" key={item.id}>
            <div className="sky-review-row">
              <div className="sky-review-copy">
                <strong>{item.title}</strong>
                {item.detail && <p>{item.detail}</p>}
                {item.blocked && <p>{item.blocked} You can skip it here.</p>}
              </div>
              <div className="sky-review-actions">
                {kind === 'streak' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(busy) || Boolean(item.blocked)}
                    onClick={() => void answer(item, 'apply')}
                  >
                    Done
                  </Button>
                )}
                {kind === 'tracking' && !item.blocked && (
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  >
                    Enter
                  </Button>
                )}
                {kind === 'meeting' && item.meeting && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      importMeeting.current = item.meeting
                      fileInput.current?.click()
                    }}
                  >
                    Import notes
                  </Button>
                )}
                <Button size="sm" disabled={Boolean(busy)} onClick={() => void answer(item, 'skip')}>
                  Skip
                </Button>
              </div>
            </div>
            {item.href && (kind === 'meeting' || kind === 'check' || item.blocked) && (
              <button type="button" className="sky-review-link" onClick={() => openSource(item.href!)}>
                Open {kind === 'check' ? 'source' : 'record'} →
              </button>
            )}
            {expanded === item.id && kind === 'tracking' && (
              <TrackingAnswers
                key={item.id}
                item={item}
                day={day}
                initial={drafts.current[item.id] ?? view?.drafts[item.id] ?? {}}
                onDraft={(values) => {
                  drafts.current[item.id] = values
                }}
                busy={Boolean(busy)}
                onSave={(values) => void answer(item, 'apply', values)}
              />
            )}
          </div>
        ))}
      </section>
    )
  }
  const pending = view?.items.length ?? 0
  const content = (
    <div className="sky-review">
      <p className="sky-review-intro">
        Catch up on {day}. Your progress saves as you go; close this and return whenever you want.
      </p>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".txt,.md,.vtt,.srt,.m4a,.mp3,.wav,.mp4"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []) as File[]
          event.currentTarget.value = ''
          const meeting = importMeeting.current
          if (files.length && meeting)
            void close(() => {
              onClose()
              onImportMeeting(files, meeting)
            })
        }}
      />
      {error && (
        <div className="sky-review-error" role="alert">
          {error}
          <Button size="compact-sm" onClick={() => void run('refresh', () => reviewRequest(`${day}/refresh`, {}))}>
            Refresh review
          </Button>
        </div>
      )}
      {!view ? (
        <p role="status">Loading review…</p>
      ) : !view.hasDay ? (
        <section className="sky-review-section">
          <h3>No day record for {day}</h3>
          <p>There is nothing to carry over or summarize. You can start a day from Today when you’re ready.</p>
        </section>
      ) : (
        <>
          <section className="sky-review-section">
            <h3>Recaps</h3>
            {view.recaps.map((job) => (
              <Job
                key={job.id}
                job={job}
                busy={busy === job.id}
                retry={() => void run(job.id, () => reviewRequest(`${day}/retry`, { id: job.id }))}
              />
            ))}
          </section>
          {section('carry', 'Carry forward')}
          {section('streak', 'Did you do these?')}
          {view.items.some((i) => i.kind === 'streak') && (
            <p className="sky-review-hint">
              Skip leaves the streak unchanged. An uncompleted past day still counts as missed.
            </p>
          )}
          {section('tracking', 'Finish tracking')}
          {section('meeting', 'Meeting notes')}
          {section('check', 'Needs a look')}
          {Object.keys(view.answers).length > 0 && (
            <details className="sky-review-history">
              <summary>{Object.keys(view.answers).length} handled or skipped</summary>
              {(Object.entries(view.answers) as Array<[string, ReviewView['answers'][string]]>).map(([id, answer]) => (
                <div className="sky-review-row" key={id}>
                  <span>
                    {answer.item.title}
                    <small>
                      {answer.result === 'moved'
                        ? `Moved to ${answer.target}`
                        : answer.result === 'skipped'
                          ? 'Skipped'
                          : 'Done'}
                    </small>
                  </span>
                  {answer.result === 'skipped' && (
                    <Button
                      size="compact-sm"
                      disabled={Boolean(busy)}
                      onClick={() => void run(id, () => reviewRequest(`${day}/answer`, { id, action: 'restore' }))}
                    >
                      Review again
                    </Button>
                  )}
                </div>
              ))}
            </details>
          )}
          <section className="sky-review-section">
            <h3>Daily summary</h3>
            {view.summary.status === 'waiting' ? (
              <p>
                {pending
                  ? 'After you handle or skip the remaining items, Sky will generate the summary from this day’s saved notes, activity, tracking, and recaps.'
                  : 'The summary will run as soon as the recaps finish.'}
              </p>
            ) : (
              <Job
                job={view.summary}
                busy={busy === 'summary'}
                retry={() => void run('summary', () => reviewRequest(`${day}/retry`, { id: 'summary' }))}
              />
            )}
            {view.summaryHref && (
              <Button variant="secondary" onClick={() => openSource(view.summaryHref!)}>
                Read summary
              </Button>
            )}
          </section>
        </>
      )}
      <footer className="sky-review-footer">
        <span role="status">
          {view ? (pending ? `${pending} remaining` : view.hasDay ? 'Review items handled' : 'Nothing to review') : ''}
        </span>
        <Button variant="secondary" onClick={() => void close()}>
          Close for now
        </Button>
      </footer>
    </div>
  )
  return phone ? (
    <Drawer opened onClose={() => void close()} position="bottom" size="100%" title={`Review ${day}`}>
      {content}
    </Drawer>
  ) : (
    <Modal opened onClose={() => void close()} size={740} title={`Review ${day}`} centered>
      {content}
    </Modal>
  )
}
