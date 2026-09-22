import './dayMostImportant.css'
import { Button, Drawer, Modal, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MIAnswer, MIDraft, MIProgress, MISuggestion, MISuggestions } from '#lib/mostImportant/types.ts'
import type { DayData } from './day.tsx'
import { MIActivity, MISuggestionSkeletons, type MIAction, type MIWorking } from './dayMostImportantProgress.tsx'
import { frames } from './turnStream.ts'
import { mountEditor, type EditorHandle } from './wysiwyg/mod.ts'

interface DraftState {
  step: 'choose' | 'write' | 'interview' | 'review'
  suggestions: MISuggestion[]
  visible: number
  context: string
  statement: string
  answers: MIAnswer[]
  question: string | null
  answer: string
  draft: MIDraft | null
  feedback: string
  direction: string
  saveRequest?: { id: string; payload: string }
}

const empty = (): DraftState => ({
  step: 'choose',
  suggestions: [],
  visible: 3,
  context: '',
  statement: '',
  answers: [],
  question: null,
  answer: '',
  draft: null,
  feedback: '',
  direction: '',
})
const storageKey = (day: string) => `sky-mi-draft:${day}`
function restore(day: string): DraftState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(day)) ?? 'null') as DraftState | null
    if (saved && ['choose', 'write', 'interview', 'review'].includes(saved.step) && Array.isArray(saved.answers))
      return { ...empty(), ...saved }
  } catch {
    /* A new or unavailable browser store starts with an empty draft. */
  }
  return empty()
}

function BodyEditor({
  body,
  disabled,
  handle,
  onChange,
}: {
  key?: number
  body: string
  disabled: boolean
  handle: { current: EditorHandle | null }
  onChange: (body: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const initial = useRef(body)
  const notify = useRef(onChange)
  notify.current = onChange
  useEffect(() => {
    if (!root.current) return
    const editor = mountEditor(
      root.current,
      {
        apiPath: '',
        content: initial.current,
        version: 0,
        local: true,
        hideFrontmatter: true,
        resolveImage: () => '',
      },
      { onStatus: () => {}, onConflict: () => {}, onChange: (content) => notify.current(content) },
    )
    root.current.setAttribute('aria-label', 'Task document')
    root.current.setAttribute('role', 'textbox')
    root.current.setAttribute('aria-multiline', 'true')
    handle.current = editor
    return () => {
      handle.current = null
      editor.destroy()
    }
  }, [handle])
  useEffect(() => {
    root.current?.setAttribute('contenteditable', String(!disabled))
  }, [disabled])
  return <div ref={root} className="sky-doc-body sky-wysiwyg sky-mi-document" />
}

/** The date key owns its draft; day polling never replaces interview answers or editor nodes. */
export function DayMostImportant({
  day,
  onSaved,
  children,
}: {
  key?: string
  day: DayData
  onSaved: (view: DayData) => void
  children: (entry: ReactNode) => ReactNode
}) {
  const ymd = day.day.ymd
  const mobile = useMediaQuery('(max-width: 900px)')
  const [opened, setOpened] = useState(false)
  const [state, setState] = useState(() => restore(ymd))
  const [busy, setBusy] = useState<MIWorking | null>(null)
  const [error, setError] = useState('')
  const [editorVersion, setEditorVersion] = useState(0)
  const [deadlineOpen, setDeadlineOpen] = useState(false)
  const editor = useRef<EditorHandle | null>(null)
  const sequence = useRef(0)
  const snapshot = useRef(state)
  snapshot.current = state
  const change = (patch: Partial<DraftState>) => setState((current) => ({ ...current, ...patch }))
  useEffect(() => {
    if (!opened) return
    const id = crypto.randomUUID()
    const activity = (active: boolean) => {
      void fetch(`/day/${ymd}/mi/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
        keepalive: true,
      }).catch(() => {})
    }
    const renew = () => activity(true)
    const release = () => activity(false)
    renew()
    const timer = setInterval(renew, 20_000)
    window.addEventListener('pagehide', release)
    window.addEventListener('pageshow', renew)
    document.addEventListener('visibilitychange', renew)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', release)
      window.removeEventListener('pageshow', renew)
      document.removeEventListener('visibilitychange', renew)
      release()
    }
  }, [opened, ymd])
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(ymd), JSON.stringify(state))
    } catch {
      /* The open draft remains usable. */
    }
  }, [state, ymd])
  useEffect(
    () => () => {
      sequence.current += 1
    },
    [],
  )

  async function request<T>(action: string, data: unknown, current: () => boolean): Promise<T> {
    const response = await fetch(`/day/${ymd}/mi/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(data),
    })
    if (!response.ok || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
      const result = (await response.json()) as T & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Sky could not finish that step. Your draft is still here.')
      return result
    }
    for await (const frame of frames(response, 35_000)) {
      if (frame.event === 'error') throw new Error(String(frame.data.error))
      if (frame.event === 'result') return frame.data as T
      if (frame.event === 'progress' && current()) {
        const progress = frame.data as unknown as MIProgress
        setBusy((working) => (working ? { ...working, progress: { ...working.progress, ...progress } } : null))
      }
    }
    throw new Error('The connection ended before Sky finished. Your work is kept here; try again.')
  }
  async function run(kind: MIAction, action: (current: () => boolean) => Promise<void>) {
    const id = ++sequence.current
    setBusy({ action: kind, started: performance.now(), progress: null })
    setError('')
    try {
      await action(() => sequence.current === id)
    } catch (failure) {
      if (sequence.current === id) setError(failure instanceof Error ? failure.message : 'Try again.')
    } finally {
      if (sequence.current === id) setBusy(null)
    }
  }
  function suggest(more = false) {
    if (more && state.visible < state.suggestions.length) {
      change({ visible: state.suggestions.length })
      return
    }
    void run('suggest', async (current) => {
      const previous = state.suggestions
      const result = await request<MISuggestions>('suggest', { previous, feedback: state.direction }, current)
      if (!current()) return
      const combined = more ? [...previous, ...result.suggestions] : result.suggestions
      change({ suggestions: combined, visible: more ? combined.length : 3, context: result.contextSummary })
      if (more && !result.suggestions.length)
        setError('No different suggestions yet. Add some direction or write your own.')
    })
  }
  function own() {
    sequence.current += 1
    setBusy(null)
    setError('')
    change({ step: 'write' })
  }
  async function advance(statement: string, answers: MIAnswer[], finish = false) {
    change({ step: 'interview', statement, answers, answer: '', question: null })
    await run(finish ? 'draft' : 'question', async (current) => {
      const input = { statement, answers }
      const result = finish
        ? { question: null }
        : await request<{ question: string | null }>('question', input, current)
      if (!current()) return
      if (result.question) {
        change({ question: result.question })
        return
      }
      setBusy({ action: 'draft', started: performance.now(), progress: null })
      const written = await request<{ draft: MIDraft }>('draft', input, current)
      if (!current()) return
      change({ step: 'review', draft: written.draft, feedback: '' })
      setEditorVersion((version) => version + 1)
    })
  }
  function answer(finish = false) {
    const answers =
      state.question && state.answer.trim()
        ? [...state.answers, { question: state.question, answer: state.answer.trim() }]
        : state.answers
    void advance(state.statement, answers, finish)
  }
  function currentDraft(): MIDraft {
    const draft = snapshot.current.draft!
    return { ...draft, body: editor.current?.content() ?? draft.body }
  }
  function refine() {
    const previous = currentDraft()
    change({ draft: previous })
    void run('refine', async (current) => {
      const result = await request<{ draft: MIDraft }>(
        'draft',
        {
          statement: state.statement,
          answers: state.answers,
          previous,
          feedback: state.feedback,
        },
        current,
      )
      if (!current()) return
      change({ draft: result.draft, feedback: '', saveRequest: undefined })
      setEditorVersion((version) => version + 1)
    })
  }
  function save() {
    const draft = currentDraft()
    const payload = JSON.stringify(draft)
    const requestId = state.saveRequest?.payload === payload ? state.saveRequest.id : crypto.randomUUID()
    change({ draft, saveRequest: { id: requestId, payload } })
    void run('save', async (current) => {
      const result = await request<{ view: DayData }>('save', { draft, requestId }, current)
      if (!current()) return
      setState(empty())
      setDeadlineOpen(false)
      setOpened(false)
      onSaved(result.view)
    })
  }
  function open() {
    setOpened(true)
    if (state.step === 'choose' && !state.suggestions.length && !state.context && !busy) suggest()
  }
  const readOnly = day.record.ended
  const hasTask = day.record.mostImportant.length > 0
  const body = (
    <div className="sky-mi-composer">
      <div className="sky-mi-scroll">
        <p className="sky-mi-date">{day.day.dateLabel}</p>
        {busy && <MIActivity work={busy} />}
        {state.step === 'choose' && (
          <>
            {!busy && <p className="sky-mi-intro">What matters most today?</p>}
            {busy && !state.suggestions.length && <MISuggestionSkeletons />}
            <div className="sky-mi-suggestions" aria-busy={Boolean(busy)}>
              {state.suggestions.slice(0, state.visible).map((item, index) => (
                <button
                  key={item.summary}
                  type="button"
                  className={`sky-mi-suggestion${index === 0 ? ' sky-mi-recommended' : ''}`}
                  title={`${item.summary}\n${item.reason}`}
                  disabled={Boolean(busy) || readOnly}
                  onClick={() => void advance(item.summary, [])}
                >
                  <span className="sky-mi-option-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="sky-mi-suggestion-copy">
                    {index === 0 && <span className="sky-mi-recommendation">Sky recommends</span>}
                    <strong>{item.summary}</strong>
                    <span className="sky-mi-reason">{item.reason}</span>
                  </span>
                  <span className="sky-mi-option-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>
            {!busy && !state.suggestions.length && (
              <p className="sky-mi-context">Start with something you want to accomplish. Sky will help develop it.</p>
            )}
            {state.context && (
              <details className="sky-mi-background">
                <summary>What informed these choices</summary>
                <p className="sky-mi-context">{state.context}</p>
              </details>
            )}
            <details className="sky-mi-direction">
              <summary>Give Sky some direction</summary>
              <Textarea
                label="Direction for suggestions"
                autosize
                minRows={2}
                value={state.direction}
                disabled={Boolean(busy)}
                onChange={(event) => change({ direction: event.currentTarget.value })}
                placeholder="What should Sky focus on?"
              />
              <Button disabled={Boolean(busy) || !state.direction.trim() || readOnly} onClick={() => suggest()}>
                Rethink suggestions
              </Button>
            </details>
          </>
        )}
        {state.step === 'write' && (
          <form
            id="sky-mi-own-task"
            onSubmit={(event) => {
              event.preventDefault()
              if (state.statement.trim()) void advance(state.statement.trim(), [])
            }}
          >
            <Textarea
              label="Your most important task"
              autoFocus
              autosize
              minRows={3}
              maxLength={12000}
              placeholder="What do you want to accomplish?"
              value={state.statement}
              disabled={Boolean(busy) || readOnly}
              onChange={(event) => change({ statement: event.currentTarget.value })}
            />
          </form>
        )}
        {state.step === 'interview' && (
          <>
            <div className="sky-mi-task-context">
              <span>Working on</span>
              <p>{state.statement}</p>
            </div>
            {state.question && (
              <section className="sky-mi-question">
                <span className="sky-mi-question-number">Question {state.answers.length + 1}</span>
                <h2 id="sky-mi-question">{state.question}</h2>
                <Textarea
                  aria-label="Answer Sky"
                  aria-describedby="sky-mi-question"
                  placeholder="Your answer…"
                  autoFocus
                  autosize
                  minRows={3}
                  maxLength={16000}
                  value={state.answer}
                  disabled={Boolean(busy) || readOnly}
                  onChange={(event) => change({ answer: event.currentTarget.value })}
                />
              </section>
            )}
            {state.answers.length > 0 && (
              <details className="sky-mi-answers">
                <summary>Your answers</summary>
                {state.answers.map((item, index) => (
                  <div key={index}>
                    <strong>{item.question}</strong>
                    <p>{item.answer}</p>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {state.step === 'review' && state.draft && (
          <>
            <p className="sky-mi-intro">Make it yours, then add it to the day.</p>
            <TextInput
              label="Most important"
              className="sky-mi-title"
              value={state.draft.summary}
              maxLength={2000}
              disabled={Boolean(busy) || readOnly}
              onChange={(event) => change({ draft: { ...state.draft!, summary: event.currentTarget.value } })}
            />
            {state.draft.dueBy || deadlineOpen ? (
              <TextInput
                label="Due by (optional)"
                onFocus={() => setDeadlineOpen(true)}
                value={state.draft.dueBy}
                maxLength={160}
                disabled={Boolean(busy) || readOnly}
                onChange={(event) => change({ draft: { ...state.draft!, dueBy: event.currentTarget.value } })}
              />
            ) : (
              <Button
                className="sky-mi-deadline"
                disabled={Boolean(busy) || readOnly}
                onClick={() => setDeadlineOpen(true)}
              >
                Add a deadline
              </Button>
            )}
            <BodyEditor
              key={editorVersion}
              body={state.draft.body}
              disabled={Boolean(busy) || readOnly}
              handle={editor}
              onChange={(content) =>
                setState((current) => ({ ...current, draft: { ...current.draft!, body: content } }))
              }
            />
            <div className="sky-mi-refinement">
              <Textarea
                label="Refine with Sky"
                placeholder="What should change?"
                autosize
                minRows={2}
                maxLength={12000}
                value={state.feedback}
                disabled={Boolean(busy) || readOnly}
                onChange={(event) => change({ feedback: event.currentTarget.value })}
              />
              <Button
                variant="secondary"
                disabled={Boolean(busy) || readOnly || !state.feedback.trim()}
                onClick={refine}
              >
                Refine draft
              </Button>
            </div>
          </>
        )}
        {error && (
          <div role="alert" className="sky-mi-error">
            {error}
            <p>
              Your work is kept here. Try again, or check <a href="/settings/ai/models">AI settings</a> if Sky is
              unavailable.
            </p>
          </div>
        )}
        {readOnly && (
          <p role="alert" className="sky-mi-error">
            This day has ended. Your draft is kept here.
          </p>
        )}
      </div>
      <footer className="sky-dialog-footer sky-mi-footer">
        {state.step !== 'choose' && state.step !== 'write' && (
          <Button
            className="sky-mi-discard"
            variant="secondary"
            disabled={Boolean(busy)}
            onClick={() => {
              setState(empty())
              setDeadlineOpen(false)
              setError('')
              setOpened(false)
            }}
          >
            Discard draft
          </Button>
        )}
        <div className="sky-mi-actions">
          {state.step === 'choose' && (
            <>
              {state.suggestions.length > 0 && (
                <Button
                  disabled={Boolean(busy) || readOnly || state.suggestions.length >= 100}
                  loading={busy?.action === 'suggest'}
                  onClick={() => suggest(true)}
                >
                  More suggestions
                </Button>
              )}
              {!busy && !state.suggestions.length && <Button onClick={() => suggest()}>Try suggestions again</Button>}
              <Button variant="primary" disabled={readOnly} onClick={own}>
                Write your own
              </Button>
            </>
          )}
          {state.step === 'write' && (
            <>
              <Button disabled={Boolean(busy)} onClick={() => change({ step: 'choose' })}>
                Back
              </Button>
              <Button
                type="submit"
                form="sky-mi-own-task"
                variant="primary"
                disabled={!state.statement.trim() || readOnly}
                loading={Boolean(busy)}
              >
                Continue
              </Button>
            </>
          )}
          {state.step === 'interview' && (
            <>
              <Button disabled={Boolean(busy) || readOnly} onClick={() => answer(true)}>
                Draft now
              </Button>
              <Button
                variant="primary"
                loading={Boolean(busy)}
                disabled={readOnly || Boolean(state.question && !state.answer.trim())}
                onClick={() => answer()}
              >
                Continue
              </Button>
            </>
          )}
          {state.step === 'review' && state.draft && (
            <>
              <Button disabled={Boolean(busy)} onClick={() => setOpened(false)}>
                Keep for later
              </Button>
              <Button
                variant="primary"
                loading={busy?.action === 'save'}
                disabled={Boolean(busy) || readOnly || !state.draft.summary.trim() || !state.draft.body.trim()}
                onClick={save}
              >
                Add to day
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
  return (
    <>
      {children(
        !readOnly && (
          <Button
            variant="secondary"
            className={hasTask ? 'sky-mi-add-another' : 'sky-plan-add sky-mi-invitation'}
            leftSection={!hasTask && <span aria-hidden="true">＋</span>}
            onClick={open}
          >
            {state.step !== 'choose' ? 'Continue draft' : hasTask ? 'Add another' : "What's most important?"}
          </Button>
        ),
      )}
      {mobile ? (
        <Drawer
          opened={opened}
          onClose={() => setOpened(false)}
          title="Most important"
          position="bottom"
          size="92%"
          className="sky-mi-sheet"
          padding={0}
          classNames={{ content: 'sky-mi-dialog', body: 'sky-mi-dialog-body' }}
        >
          {body}
        </Drawer>
      ) : (
        <Modal
          opened={opened}
          onClose={() => setOpened(false)}
          title="Most important"
          centered
          size={780}
          className="sky-mi-modal"
          padding={0}
          classNames={{ content: 'sky-mi-dialog', body: 'sky-mi-dialog-body' }}
        >
          {body}
        </Modal>
      )}
    </>
  )
}
