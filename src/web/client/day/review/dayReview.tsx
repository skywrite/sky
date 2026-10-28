import './dayReview.css'
import { Button, Drawer, Modal, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import {
  REVIEW_STEPS,
  reviewItemStep,
  type ReviewItem,
  type ReviewJob,
  type ReviewStep,
  type ReviewView,
} from '../../../../service/handler/day/review/types.ts'
import type { MeetingImport } from '../../import/import.tsx'
import { ReviewSteps, steps } from './reviewSteps.tsx'

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

/** Every tab shows the return prompt until the person acts on it in one of them. */
export function useReviewPrompt(): [string | null, (day: string) => void] {
  const [pending, setPending] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => {
    let alive = true,
      checking = false
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return
      checking = true
      try {
        const status = await reviewRequest<{ pending: string | null }>('status')
        if (alive) setPending(status.pending)
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
  }, [])
  return [pending === dismissed ? null : pending, setDismissed]
}

function Job({ job, retry, busy }: { job: ReviewJob; retry: () => void; busy: boolean }) {
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
  item: ReviewItem
  day: string
  initial: Record<string, string>
  onDraft: (values: Record<string, string>) => Promise<void>
  onSave: (values: Record<string, string>) => void
  busy: boolean
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const edit = (name: string, value: string) => {
    const next = { ...values, [name]: value }
    setValues(next)
    void onDraft(next).then(
      () => setError(null),
      () => setError('This draft has not saved. Keep this review open and try again.'),
    )
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
  prompted = false,
  onEngage,
  onClose,
  onChanged,
  navigate,
  onImportMeeting,
}: {
  day: string
  /** Shown by the return prompt rather than opened by the person. */
  prompted?: boolean
  /** The person acted in a prompted review, which makes it theirs to keep open. */
  onEngage?: () => void
  onClose: () => void
  onChanged: () => void
  navigate: (href: string) => void
  onImportMeeting: (files: File[], meeting: MeetingImport) => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [view, setView] = useState<ReviewView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const closing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const importMeeting = useRef<ReviewItem['meeting']>(undefined)
  const generation = useRef(0)
  const working = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const drafts = useRef<Record<string, Record<string, string>>>({})
  const draftWrites = useRef(Promise.resolve())
  const pendingDrafts = useRef(0)
  const failedDrafts = useRef(new Set<string>())
  // Until the person acts in a prompted review, every tab shows it, and a tab dropping its copy never pauses it.
  const engaged = useRef(!prompted)
  const engage = (keep = true) => {
    if (engaged.current) return
    engaged.current = true
    void reviewRequest(`${day}/acknowledge`, {}).catch(() => {})
    if (keep) onEngage?.()
  }
  const step = view?.step ?? 'carry'
  const stepIndex = REVIEW_STEPS.indexOf(step)
  useEffect(() => {
    const title = `sky · Review ${day} · ${steps[step].label}`
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
  }, [day, step])
  useEffect(() => {
    if (view?.step) heading.current?.focus()
  }, [view?.step])
  useEffect(() => {
    let alive = true
    const read = async (open: boolean) => {
      if (working.current || closing.current) return
      const version = generation.current
      try {
        const fresh = await reviewRequest<ReviewView>(
          open ? `${day}/open` : day,
          open ? (engaged.current ? {} : { prompted: true }) : undefined,
        )
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
      if (engaged.current) void reviewRequest(`${day}/close`, {}).catch(() => {})
    }
    window.addEventListener('pagehide', pause)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener('pagehide', pause)
      if (!closing.current) pause()
    }
  }, [day])
  const saveDraft = (id: string, values: Record<string, string>) => {
    drafts.current[id] = values
    pendingDrafts.current++
    setSavingDraft(true)
    const write = draftWrites.current.then(async () => {
      try {
        await reviewRequest(`${day}/draft`, { id, values })
        failedDrafts.current.delete(id)
      } catch (e) {
        failedDrafts.current.add(id)
        throw e
      } finally {
        if (--pendingDrafts.current === 0) setSavingDraft(false)
      }
    })
    draftWrites.current = write.catch(() => {})
    return write
  }
  const flushDrafts = async () => {
    await draftWrites.current
    for (const id of failedDrafts.current) await saveDraft(id, drafts.current[id])
  }
  const run = async (id: string, action: () => Promise<ReviewView>) => {
    if (working.current || closing.current) return
    working.current = true
    generation.current++
    setBusy(id)
    setError(null)
    try {
      await flushDrafts()
      const fresh = await action()
      setView(fresh)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      generation.current++
      working.current = false
      setBusy(null)
    }
  }
  const answer = (item: ReviewItem, action: 'skip' | 'apply', values?: Record<string, string>) =>
    run(item.id, () => reviewRequest(`${day}/answer`, { id: item.id, action, values }))
  const close = async (after = onClose) => {
    if (working.current || closing.current) return
    closing.current = true
    engage(false)
    setBusy('close')
    try {
      await flushDrafts()
      await reviewRequest(`${day}/close`, {})
      onChanged()
      after()
    } catch (e) {
      closing.current = false
      setError(`Could not save the pause: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }
  const openSource = (href: string) => {
    void close(() => navigate(href))
  }
  const items = view?.items.filter((item) => reviewItemStep(item) === step) ?? []
  const movable = items.filter((item) => item.kind === 'carry' && !item.blocked)
  const history = Object.entries<ReviewView['answers'][string]>(view?.answers ?? {}).filter(
    ([, answer]) => reviewItemStep(answer.item) === step,
  )
  const pending = view?.items.length ?? 0
  const recapsDone = view?.recaps.filter((job) => job.status === 'done').length ?? 0
  const recapFailed = view?.recaps.some((job) => job.status === 'error') ?? false
  const goTo = (next: ReviewStep, skip = false) =>
    void run('step', () =>
      reviewRequest(`${day}/step`, { step: next, ...(skip ? { skipIds: items.map((item) => item.id) } : {}) }),
    )
  const moveAll = () =>
    void run('carry', () => reviewRequest(`${day}/move`, { ids: movable.slice(0, 100).map((item) => item.id) }))
  const content = (
    <div className="sky-review" onPointerDownCapture={() => engage()} onKeyDownCapture={() => engage()}>
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
      {view?.hasDay && <ReviewSteps view={view} busy={Boolean(busy)} goTo={goTo} />}
      <div className="sky-review-body">
        {error && (
          <div className="sky-review-error" role="alert">
            {error}
            <Button
              size="compact-sm"
              disabled={Boolean(busy)}
              onClick={() => void run('refresh', () => reviewRequest(`${day}/refresh`, {}))}
            >
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
            <header className="sky-review-step-head">
              <p className="sky-review-eyebrow">
                Step {stepIndex + 1} of {REVIEW_STEPS.length}
              </p>
              <h2 ref={heading} tabIndex={-1}>
                {steps[step].title}
              </h2>
              <p>{steps[step].description}</p>
            </header>
            {step === 'chat' ? (
              <section className="sky-review-section" aria-label="Continuing chats">
                {view.chats.length ? (
                  view.chats.map((chat) => (
                    <div className="sky-review-item" key={chat.id}>
                      <div className="sky-review-copy">
                        <strong>{chat.title}</strong>
                        <p>
                          Started {chat.started}
                          {chat.lastActive ? ` · Last active ${chat.lastActive}` : ''}
                        </p>
                        <p>
                          {chat.saves
                            ? 'Stays open in Today. This day’s messages can be included in its summary.'
                            : 'Temporary chat · Not included in the saved summary.'}
                        </p>
                      </div>
                      <div className="sky-review-actions">
                        <Button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            openSource(
                              `/thread/${encodeURIComponent(chat.id)}?returnTo=${encodeURIComponent(`/${day}?review=${day}`)}`,
                            )
                          }
                        >
                          Open chat
                        </Button>
                        {chat.saves && (
                          <Button
                            disabled={Boolean(busy) || chat.busy}
                            loading={busy === chat.id}
                            onClick={() => void run(chat.id, () => reviewRequest(`${day}/chat/close`, { id: chat.id }))}
                          >
                            {chat.busy ? 'Chat is working…' : 'Save & close'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sky-review-empty">
                    <span aria-hidden="true">✓</span>
                    <p>{steps.chat.empty}</p>
                  </div>
                )}
                <p className="sky-review-hint">
                  Open chats carry forward automatically. They don’t hold up your daily summary.
                </p>
              </section>
            ) : step === 'summary' ? (
              <>
                <section className="sky-review-summary" aria-label="Daily summary">
                  {view.summaryHref ? (
                    <>
                      <h3>Your summary is ready</h3>
                      <p>Your review is saved. Open the summary whenever you’re ready.</p>
                      <Button variant="primary" onClick={() => openSource(view.summaryHref!)} disabled={Boolean(busy)}>
                        Read summary
                      </Button>
                    </>
                  ) : view.summary.status === 'waiting' ? (
                    <>
                      <h3>
                        {pending
                          ? 'A few things still need a decision'
                          : recapFailed
                            ? 'A recap needs another try'
                            : 'Bringing your day together'}
                      </h3>
                      <p>
                        {pending
                          ? 'Handle or skip the remaining items, and Sky will generate your summary automatically.'
                          : recapFailed
                            ? 'Retry the failed recap below so it can be included in your summary.'
                            : 'Your summary will start automatically as soon as the recaps finish.'}
                      </p>
                      {pending > 0 && (
                        <Button
                          variant="primary"
                          disabled={Boolean(busy)}
                          onClick={() => goTo(reviewItemStep(view.items[0]))}
                        >
                          Review remaining items ({pending})
                        </Button>
                      )}
                    </>
                  ) : (
                    <Job
                      job={view.summary}
                      busy={Boolean(busy)}
                      retry={() => void run('summary', () => reviewRequest(`${day}/retry`, { id: 'summary' }))}
                    />
                  )}
                </section>
                <section className="sky-review-recaps" aria-label="Activity recaps">
                  <h3>
                    Activity recaps{' '}
                    <span>
                      {recapsDone} of {view.recaps.length} ready
                    </span>
                  </h3>
                  {view.recaps.map((job) => (
                    <Job
                      key={job.id}
                      job={job}
                      busy={Boolean(busy)}
                      retry={() => void run(job.id, () => reviewRequest(`${day}/retry`, { id: job.id }))}
                    />
                  ))}
                </section>
              </>
            ) : (
              <>
                {step === 'carry' && items.length > 0 && (
                  <div className="sky-review-carry">
                    <span>
                      {items.length} unfinished · Moving to {view.today}
                    </span>
                    <Button
                      variant="primary"
                      disabled={Boolean(busy) || !movable.length}
                      loading={busy === 'carry'}
                      onClick={moveAll}
                    >
                      Move to today{movable.length ? ` (${Math.min(movable.length, 100)})` : ''}
                    </Button>
                  </div>
                )}
                <section className="sky-review-section" aria-label={steps[step].label}>
                  {!items.length && (
                    <div className="sky-review-empty" role="status">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <h3>{history.length ? 'All set here' : 'Nothing to catch up on'}</h3>
                        <p>
                          {history.length
                            ? 'Your choices are saved. You can continue to the next step.'
                            : steps[step].empty}
                        </p>
                      </div>
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
                          {item.kind === 'streak' && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={Boolean(busy) || Boolean(item.blocked)}
                              onClick={() => void answer(item, 'apply')}
                            >
                              Done
                            </Button>
                          )}
                          {item.kind === 'meeting' && item.meeting && (
                            <Button
                              variant="primary"
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
                      {item.href && (item.kind === 'meeting' || item.kind === 'check' || item.blocked) && (
                        <button
                          type="button"
                          className="sky-review-link"
                          disabled={Boolean(busy)}
                          onClick={() => openSource(item.href!)}
                        >
                          Open {item.kind === 'check' ? 'source' : 'record'} →
                        </button>
                      )}
                      {item.kind === 'tracking' && !item.blocked && (
                        <TrackingAnswers
                          key={item.id}
                          item={item}
                          day={day}
                          initial={drafts.current[item.id] ?? view.drafts[item.id] ?? {}}
                          onDraft={(values) => saveDraft(item.id, values)}
                          busy={Boolean(busy)}
                          onSave={(values) => void answer(item, 'apply', values)}
                        />
                      )}
                    </div>
                  ))}
                </section>
                {step === 'streak' && items.length > 0 && (
                  <p className="sky-review-hint">
                    Skip leaves the streak unchanged. An uncompleted past day still counts as missed.
                  </p>
                )}
                {history.length > 0 && (
                  <details className="sky-review-history" key={step}>
                    <summary>{history.length} handled or skipped</summary>
                    {history.map(([id, answer]) => (
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
                            onClick={() =>
                              void run(id, () => reviewRequest(`${day}/answer`, { id, action: 'restore' }))
                            }
                          >
                            Review again
                          </Button>
                        )}
                      </div>
                    ))}
                  </details>
                )}
              </>
            )}
          </>
        )}
      </div>
      <footer className="sky-review-footer">
        {view?.hasDay && (
          <div className="sky-review-status">
            <span role="status">
              {busy || savingDraft
                ? 'Saving…'
                : failedDrafts.current.size
                  ? 'Draft not saved'
                  : 'Progress saved · Return anytime'}
            </span>
            {step !== 'summary' && (
              <button
                type="button"
                className="sky-review-link"
                disabled={Boolean(busy)}
                onClick={() => goTo('summary')}
              >
                {recapFailed
                  ? 'Recap needs attention'
                  : recapsDone === view.recaps.length
                    ? 'Recaps ready'
                    : `Preparing recaps · ${recapsDone}/${view.recaps.length}`}{' '}
                →
              </button>
            )}
          </div>
        )}
        <div className="sky-review-footer-actions">
          <Button variant="secondary" disabled={Boolean(busy)} loading={busy === 'close'} onClick={() => void close()}>
            Close for now
          </Button>
          {view?.hasDay && (
            <div className="sky-review-navigation">
              {stepIndex > 0 && (
                <Button disabled={Boolean(busy)} onClick={() => goTo(REVIEW_STEPS[stepIndex - 1])}>
                  Back
                </Button>
              )}
              {step !== 'summary' && (
                <Button
                  variant={items.length ? 'secondary' : 'primary'}
                  disabled={Boolean(busy)}
                  loading={busy === 'step'}
                  rightSection={<span aria-hidden="true">→</span>}
                  onClick={() => goTo(REVIEW_STEPS[stepIndex + 1], items.length > 0)}
                >
                  {items.length ? (history.length ? 'Skip remaining' : 'Skip this step') : 'Continue'}
                </Button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  )
  const dialogProps = {
    opened: true,
    onClose: () => void close(),
    title: `Review ${day}`,
    classNames: { content: 'sky-review-dialog-content', body: 'sky-review-dialog-body' },
    closeButtonProps: { 'aria-label': 'Close review and save your place', disabled: Boolean(busy) },
  }
  return phone ? (
    <Drawer {...dialogProps} position="bottom" size="100%">
      {content}
    </Drawer>
  ) : (
    <Modal {...dialogProps} size={740} centered>
      {content}
    </Modal>
  )
}
