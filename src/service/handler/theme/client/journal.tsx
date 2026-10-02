import { ActionIcon, Button, Modal, TextInput } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JournalAction, JournalView } from '#lib/journal/types.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fileHref } from './explorer.tsx'
import { journalHref, type JournalRoute } from './journalRoutes.ts'
import { MarkdownEditor, type MarkdownWriter } from './markdownEditor.tsx'
import './journal.css'

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/journal/_api/${path}`,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined,
  )
  const value = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(value.message ?? 'Could not open your journal. Try again.')
  return value
}

export function useJournal(day: string | null) {
  const [view, setView] = useState<JournalView | null>(null)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const reload = useCallback(async () => {
    if (!day) return
    const request = ++revision.current
    try {
      const next = await api<JournalView>(day)
      if (request === revision.current) {
        setView(next)
        setError('')
      }
    } catch (cause) {
      if (request === revision.current)
        setError(cause instanceof Error ? cause.message : 'Could not load your journal.')
    }
  }, [day])
  useEffect(() => {
    setView(null)
    setError('')
    void reload()
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload()
    }, 2500)
    return () => {
      revision.current++
      window.clearInterval(timer)
    }
  }, [reload])
  return { view, error, reload }
}

export function JournalMain({
  route,
  search,
  navigate,
}: {
  route: JournalRoute
  search: string
  navigate(to: string, replace?: boolean): void
}) {
  const { view, error: readError, reload } = useJournal(route.day)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customTitle, setCustomTitle] = useState('')
  const [dismissedNotice, setDismissedNotice] = useState<{ topic: string; question: string } | null>(null)
  const writers = useRef(new Map<string, MarkdownWriter>())
  const started = useRef(false)
  const session = view?.session
  const topic = session?.topics.find((t) => t.id === (route.topic ?? session.current))
  useEffect(() => {
    if (session && !route.topic) navigate(journalHref(route.day, session.current), true)
  }, [session?.current, route.day, route.topic])
  const questions = topic?.questions.filter((question) => !question.dismissed) ?? []
  const dismissedQuestions = topic?.questions.filter((question) => question.dismissed) ?? []
  const operation = session?.operation
  const running = operation?.status === 'running'
  const written =
    session?.topics.filter((t) => Object.values<string>(view?.answers[t.id] ?? {}).some((a) => a.trim())) ?? []
  const position = session?.topics.findIndex((t) => t.id === topic?.id) ?? 0
  const upcoming = session?.topics
    .slice(position + 1)
    .find((t) => !t.skipped && !t.coveredBy && t.questions.some((question) => !question.dismissed))
  let dateLabel = route.day
  try {
    const date = new PlainDate(route.day)
    dateLabel = `${date.dayLong}, ${date.ymd}`
  } catch {
    /* Route error is shown below. */
  }
  useEffect(() => {
    document.title = `sky · ${topic ? `${topic.summary ?? topic.title} · ` : ''}Journal · ${route.day}`
  }, [route.day, topic?.title, topic?.summary])
  const perform = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete this journal action.')
    } finally {
      setBusy(false)
    }
  }
  const flush = async () => {
    for (const writer of writers.current.values())
      if (!(await writer.flush())) {
        setError('An answer is not saved yet. Resolve its message below before continuing.')
        return false
      }
    return true
  }
  const operationRequest = async (action: JournalAction, topicId?: string) => {
    await api(`${route.day}/operation`, { id: crypto.randomUUID(), action, topic: topicId })
    await reload()
  }
  const start = () =>
    perform(async () => {
      await api(`${route.day}/start`, {})
      await reload()
      await operationRequest('prepare')
    })
  useEffect(() => {
    if (!view || session || started.current || !new URLSearchParams(search).has('start')) return
    started.current = true
    void start()
  }, [view, session, search])
  const finishTopic = async (rename = false) => {
    if (!topic || !view?.namingAvailable) return
    setNaming(true)
    try {
      await api(`${route.day}/topics/${topic.id}`, { action: rename ? 'rename' : 'finish' })
    } finally {
      setNaming(false)
    }
  }
  const open = (id: string) =>
    perform(async () => {
      if (!(await flush())) return
      await finishTopic()
      await api(`${route.day}/topics/${id}`, { action: 'select' })
      setPickerOpen(false)
      setSourcesOpen(false)
      navigate(journalHref(route.day, id))
      await reload()
    })
  const finish = () =>
    perform(async () => {
      if (!(await flush())) return
      await finishTopic()
      navigate(`/${route.day}`)
    })
  const next = () => (upcoming ? open(upcoming.id) : finish())
  const skip = () =>
    perform(async () => {
      if (!topic || !(await flush())) return
      await finishTopic()
      await api(`${route.day}/topics/${topic.id}`, { action: 'skip' })
      if (upcoming) await open(upcoming.id)
      else navigate(`/${route.day}`)
    })
  const changeQuestion = (questionId: string, action: 'dismiss' | 'restore') =>
    perform(async () => {
      if (!topic) return
      const writer = writers.current.get(`${topic.id}/${questionId}`)
      if (action === 'dismiss' && writer && !(await writer.flush())) {
        setError('This answer is not saved yet. Resolve its message before dismissing the question.')
        return
      }
      await api(`${route.day}/topics/${topic.id}/questions/${questionId}`, { action })
      setDismissedNotice(action === 'dismiss' ? { topic: topic.id, question: questionId } : null)
      await reload()
    })
  const deeper = (action: 'deeper' | 'reframe') =>
    perform(async () => {
      if (topic && (await flush())) await operationRequest(action, topic.id)
    })
  return (
    <div className="sky-main sky-journal">
      <header className="sky-journal-header">
        <Button disabled={busy} onClick={() => void finish()}>
          ← {dateLabel}
        </Button>
        {session && (
          <Button onClick={() => setPickerOpen(true)}>
            Your reflections <span className="sky-journal-count">{written.length} written</span>
          </Button>
        )}
      </header>
      <div className="sky-journal-focus">
        {naming && (
          <p className="sky-journal-status" role="status">
            Finishing your reflection…
          </p>
        )}
        {(error || readError) && (
          <div role="alert" className="sky-journal-error">
            <p>{error || readError}</p>
            {readError && <Button onClick={() => void reload()}>Retry loading</Button>}
          </div>
        )}
        {!view && !readError && <p className="sky-journal-status">Opening your journal…</p>}
        {view && !session && (
          <section className="sky-journal-welcome">
            <span className="sky-journal-eyebrow">A little room to reflect</span>
            <h1>What’s on your mind today?</h1>
            <p>
              Start with Health and Mood. Sky will read your recent days and bring a few thoughtful questions for
              whatever else deserves a moment.
            </p>
            <Button variant="primary" loading={busy} onClick={() => void start()}>
              Start journaling
            </Button>
            <p className="sky-journal-note">Take the questions that help. Pass on the rest.</p>
          </section>
        )}
        {session && (
          <>
            {running && (
              <div className="sky-journal-status" role="status">
                <span className="sky-journal-pulse" />
                {operation.stage}
                <span>You can keep writing.</span>
              </div>
            )}
            {operation?.status === 'failed' && (
              <div className="sky-journal-error" role="alert">
                <p>
                  Sky couldn’t {operation.action === 'prepare' ? 'prepare your questions' : 'prepare that follow-up'}.{' '}
                  {operation.error}
                </p>
                <Button
                  disabled={busy}
                  onClick={() => void perform(() => operationRequest(operation.action, operation.topic))}
                >
                  Retry questions
                </Button>
                <Button component="a" href="/settings/ai">
                  AI settings
                </Button>
              </div>
            )}
            {!session.prepared && !running && operation?.status !== 'failed' && (
              <Button onClick={() => void perform(() => operationRequest('prepare'))}>Find questions for today</Button>
            )}
            {!topic ? (
              <div className="sky-journal-welcome">
                <h1>Choose a reflection</h1>
                <p>This question is no longer in the session. Your other reflections are here.</p>
                <Button onClick={() => setPickerOpen(true)}>Your reflections</Button>
              </div>
            ) : (
              <article key={topic.id} className="sky-journal-reflection">
                <div className="sky-journal-kicker">
                  <span>
                    {topic.staple
                      ? 'Your regular check-in'
                      : topic.questions[0]?.origin === 'regular'
                        ? 'Your reflection'
                        : 'An invitation from Sky'}
                  </span>
                  <span>{topic.title}</span>
                </div>
                {topic.file && view.namingAvailable && (
                  <div className="sky-journal-saved">
                    <span>
                      {topic.summary
                        ? `${topic.journalType} · ${topic.summary}`
                        : `Saved to ${topic.journalType ?? (topic.staple ? topic.title : 'Misc')}`}
                    </span>
                    <Button
                      size="compact-sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          if (!(await flush())) return
                          await finishTopic(true)
                          await reload()
                        })
                      }
                    >
                      {topic.summary ? 'Rename summary' : 'Name from my writing'}
                    </Button>
                  </div>
                )}
                {questions.length > 0 && (topic.observation || topic.sources.length > 0) && (
                  <aside className="sky-journal-context" aria-label="Context">
                    <span className="sky-journal-eyebrow">Context</span>
                    {topic.observation && <p>{topic.observation}</p>}
                    {topic.sources.length > 0 && (
                      <Button
                        className="sky-journal-source-link"
                        size="compact-sm"
                        onClick={() => setSourcesOpen(true)}
                      >
                        View sources
                      </Button>
                    )}
                  </aside>
                )}
                {(topic.skipped || topic.coveredBy) && (
                  <div className="sky-journal-aside">
                    <p>
                      {topic.coveredBy
                        ? `Your writing in “${session.topics.find((t) => t.id === topic.coveredBy)?.title ?? 'another reflection'}” may have covered this.`
                        : 'You passed on this question. It’s here if you want to return.'}
                    </p>
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          await api(`${route.day}/topics/${topic.id}`, { action: 'restore' })
                          await reload()
                        })
                      }
                    >
                      Bring it back
                    </Button>
                  </div>
                )}
                {view.problems[topic.id] && (
                  <div className="sky-journal-error" role="alert">
                    <p>{view.problems[topic.id]}</p>
                    {topic.file && (
                      <a href={fileHref(topic.file)} target="_blank" rel="noreferrer">
                        Review the saved file
                      </a>
                    )}
                  </div>
                )}
                {questions.map((question, index) => (
                  <section key={`${question.id}:${question.text}`} className="sky-journal-question">
                    {question.origin === 'followup' && (
                      <div className="sky-journal-followup-label">A little deeper</div>
                    )}
                    <div className="sky-journal-question-heading">
                      {index === 0 ? <h1>{question.text}</h1> : <h2>{question.text}</h2>}
                      <ActionIcon
                        size={44}
                        className="sky-journal-question-dismiss"
                        aria-label={`Dismiss question: ${question.text}`}
                        title="Dismiss question"
                        disabled={busy}
                        onClick={() => void changeQuestion(question.id, 'dismiss')}
                      >
                        <span aria-hidden="true">×</span>
                      </ActionIcon>
                    </div>
                    <MarkdownEditor
                      apiPath={`/journal/_api/${route.day}/topics/${topic.id}/answers/${question.id}`}
                      draftKey={`${session.id}/${topic.id}/${question.id}`}
                      label={`Your answer to ${question.text}`}
                      onReady={(writer) => {
                        const id = `${topic.id}/${question.id}`
                        if (writer) writers.current.set(id, writer)
                        else writers.current.delete(id)
                      }}
                    />
                  </section>
                ))}
                {questions.length === 0 && (
                  <p className="sky-journal-note">All questions dismissed. You can move on.</p>
                )}
                {dismissedNotice?.topic === topic.id &&
                  dismissedQuestions.some((question) => question.id === dismissedNotice.question) && (
                    <div className="sky-journal-dismissed-notice" role="status">
                      <span>Question dismissed.</span>
                      <Button
                        size="compact-sm"
                        disabled={busy}
                        onClick={() => void changeQuestion(dismissedNotice.question, 'restore')}
                      >
                        Undo
                      </Button>
                    </div>
                  )}
                {dismissedQuestions.length > 0 && (
                  <details className="sky-journal-dismissed">
                    <summary>Dismissed questions ({dismissedQuestions.length})</summary>
                    {dismissedQuestions.map((question) => (
                      <div key={question.id} className="sky-journal-dismissed-row">
                        <div>
                          <p>{question.text}</p>
                          {view.answers[topic.id]?.[question.id]?.trim() && <small>Your answer is saved.</small>}
                        </div>
                        <Button
                          size="compact-sm"
                          disabled={busy}
                          aria-label={`Restore question: ${question.text}`}
                          onClick={() => void changeQuestion(question.id, 'restore')}
                        >
                          Restore
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
                {questions.length > 0 && (
                  <div className="sky-journal-think">
                    <Button
                      disabled={busy || running || Boolean(view.problems[topic.id])}
                      onClick={() => void deeper('deeper')}
                    >
                      ✧ Go deeper
                    </Button>
                    {!topic.staple && !topic.file && (
                      <Button disabled={busy || running} onClick={() => void deeper('reframe')}>
                        Try another angle
                      </Button>
                    )}
                    {operation?.status === 'complete' && operation.topic === topic.id && (
                      <span role="status">{operation.stage}</span>
                    )}
                  </div>
                )}
                <footer className="sky-journal-footer">
                  <Button disabled={busy} onClick={() => void skip()}>
                    Pass for now
                  </Button>
                  <div>
                    <Button disabled={busy} onClick={() => void finish()}>
                      Done for now
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => void next()}>
                      {upcoming ? `Next: ${upcoming.title}` : 'Back to day'} →
                    </Button>
                  </div>
                </footer>
              </article>
            )}
          </>
        )}
      </div>
      <Modal opened={sourcesOpen} onClose={() => setSourcesOpen(false)} title="Sources" size="lg">
        <p className="sky-journal-note">
          These passages informed the question. The connection is Sky’s interpretation.
        </p>
        {topic?.sources.map((source, index) => (
          <section key={`${source.path}:${index}`} className="sky-journal-source">
            <a href={fileHref(source.path)} target="_blank" rel="noreferrer">
              {source.title} ↗
            </a>
            <blockquote>{source.quote}</blockquote>
          </section>
        ))}
      </Modal>
      <Modal opened={pickerOpen} onClose={() => setPickerOpen(false)} title="Your reflections" size="lg">
        <p className="sky-journal-note">A few places to start. You don’t need to answer everything.</p>
        <div className="sky-journal-topics">
          {session?.topics.map((item) => (
            <button
              key={item.id}
              onClick={() => void open(item.id)}
              aria-current={item.id === topic?.id ? 'step' : undefined}
            >
              <span>{item.title}</span>
              <small>
                {item.questions.every((question) => question.dismissed)
                  ? 'Questions dismissed'
                  : written.some((t) => t.id === item.id)
                    ? 'Written'
                    : item.staple
                      ? 'Your regular check-in'
                      : item.coveredBy
                        ? 'May already be covered'
                        : item.skipped
                          ? 'Passed for now'
                          : 'Ready when you are'}
              </small>
            </button>
          ))}
        </div>
        <form
          className="sky-journal-custom"
          onSubmit={(event) => {
            event.preventDefault()
            void perform(async () => {
              if (!(await flush())) return
              const result = await api<{ id: string }>(`${route.day}/topics`, { title: customTitle })
              setCustomTitle('')
              await reload()
              await open(result.id)
            })
          }}
        >
          <TextInput
            label="Something else on your mind?"
            placeholder="Name your own reflection"
            value={customTitle}
            onChange={(event) => setCustomTitle(event.currentTarget.value)}
            maxLength={80}
          />
          <Button type="submit" disabled={!customTitle.trim() || busy}>
            Write about this
          </Button>
        </form>
      </Modal>
    </div>
  )
}
