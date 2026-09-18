import { Button, Checkbox, Loader, Modal, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'
import {
  CAPTURE_HORIZON_CHOICES as horizons,
  type CaptureHorizon,
  type CaptureRequest,
  type CaptureResponse,
} from '#lib/workstreams/captureTypes.ts'
import { fileHref } from './explorer.tsx'
import { captureSteps, captureStepRequest, type CaptureStep } from './workstreamsCaptureWizard.ts'
import { workstreamRequest } from './workstreamsRequest.ts'
import './workstreamsCapture.css'

const timingQuestion: NonNullable<CaptureResponse['question']> = {
  field: 'timing',
  prompt: 'Roughly when do you want this done?',
  choices: horizons,
}
const stepLabel = (step: CaptureStep) =>
  step.response.question?.field === 'timing'
    ? 'Timing'
    : step.response.question?.field === 'outcome'
      ? 'Outcome'
      : step.response.question
        ? 'Context'
        : 'Review'
const answerKey = (step: CaptureStep) => step.response.question?.field + ':' + step.response.question?.prompt

export function WorkstreamCapture({
  opened,
  initialIntent,
  parentId,
  busy,
  onClose,
  onCreate,
  onOpenWeek,
}: {
  opened: boolean
  initialIntent: string
  parentId?: string
  busy: boolean
  onClose: () => void
  onCreate: (input: unknown) => Promise<void>
  onOpenWeek: (id: string) => void
}) {
  const touch = useMediaQuery('(pointer: coarse)') ?? false
  const [intent, setIntent] = useState(initialIntent)
  const [outcome, setOutcome] = useState(initialIntent.trim())
  const [steps, setSteps] = useState<CaptureStep[]>([])
  const [cursor, setCursor] = useState(0)
  const [thinking, setThinking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(false)
  const [assist, setAssist] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saveLocked, setSaveLocked] = useState(false)
  const answerInput = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<AbortController | null>(null)
  const lastRequest = useRef<{ request: CaptureRequest; prefix: CaptureStep[] } | null>(null)
  const drafts = useRef(new Map<string, string>())
  const requestId = useRef(crypto.randomUUID())
  const savePending = useRef(false)
  const saveAttempt = useRef<{ forWeek: boolean; payload: Record<string, unknown> } | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const step = cursor ? steps[cursor - 1] : undefined
  const result = step?.response
  const question = result?.question
  const locked = busy || saving || saveLocked

  const cancel = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    setThinking(false)
  }, [])
  const accept = useCallback((request: CaptureRequest, response: CaptureResponse, prefix: CaptureStep[]) => {
    const next = captureSteps(request, response, prefix.length === 0).map((entry) => ({
      ...entry,
      answer: drafts.current.get(answerKey(entry)) ?? entry.answer,
    }))
    setSteps([...prefix, ...next])
    setCursor(prefix.length + next.length)
    setEditing(false)
  }, [])
  const analyze = useCallback(
    async (request: CaptureRequest, prefix: CaptureStep[]) => {
      pending.current?.abort()
      const controller = new AbortController()
      pending.current = controller
      lastRequest.current = { request, prefix }
      setThinking(true)
      setError('')
      try {
        const response = await workstreamRequest<CaptureResponse>('/capture', 'POST', request, controller.signal)
        if (pending.current === controller && !controller.signal.aborted) accept(request, response, prefix)
      } catch (problem) {
        if (pending.current === controller && !controller.signal.aborted)
          setError(problem instanceof Error ? problem.message : 'Sky could not finish reading the context. Try again.')
      } finally {
        if (pending.current === controller) {
          pending.current = null
          setThinking(false)
        }
      }
    },
    [accept],
  )

  useEffect(() => {
    if (opened) {
      setIntent(initialIntent)
      setOutcome(initialIntent.trim())
      setSteps([])
      setCursor(0)
      setThinking(false)
      setSaving(false)
      setError('')
      setManual(false)
      setAssist(true)
      setEditing(false)
      setSaveLocked(false)
      drafts.current.clear()
      savePending.current = false
      saveAttempt.current = null
      requestId.current = crypto.randomUUID()
      lastRequest.current = null
      if (initialIntent.trim()) void analyze({ intent: initialIntent, answers: [] }, [])
    }
    return cancel
  }, [opened, initialIntent, analyze, cancel])

  useEffect(() => {
    if (!thinking && !error && (cursor === 0 || (question && question.field !== 'timing'))) answerInput.current?.focus()
  }, [cursor, thinking, error, question?.field, question?.prompt])

  const move = (index: number) => {
    if (locked || index < 0 || index > steps.length) return
    cancel()
    setError('')
    setEditing(false)
    setCursor(index)
  }
  const close = () => {
    if (savePending.current) return
    cancel()
    onClose()
  }
  const changeIntent = (value: string) => {
    if (locked || value === intent) return
    cancel()
    setIntent(value)
    setOutcome(value.trim())
    setSteps([])
    drafts.current.clear()
    lastRequest.current = null
    setError('')
  }
  const changeAnswer = (value: string, horizon?: CaptureHorizon) => {
    if (!step || locked) return
    if (value === step.answer && (horizon === undefined || horizon === step.horizon)) return
    cancel()
    if (question?.field !== 'timing') drafts.current.set(answerKey(step), value)
    setSteps([...steps.slice(0, cursor - 1), { ...step, answer: value, horizon: horizon ?? step.horizon }])
    setError('')
  }
  const localResult = (request: CaptureRequest): CaptureResponse => ({
    title: request.intent.trim().split('\n')[0]!.slice(0, 160),
    outcome: request.intent.trim(),
    understanding: '',
    horizon: request.horizon ?? null,
    horizonLabel: horizons.find((item) => item.value === request.horizon)?.label ?? 'Timing not set',
    question: request.horizon ? null : timingQuestion,
    sources: [],
    contextLimited: false,
  })
  const next = () => {
    if (locked || thinking) return
    if (cursor < steps.length) {
      move(cursor + 1)
      return
    }
    if (!cursor) {
      if (!intent.trim()) return
      const request: CaptureRequest = { intent, answers: [] }
      if (manual) accept(request, localResult(request), [])
      else void analyze(request, [])
      return
    }
    if (!step || !question || (question.field === 'timing' ? !step.horizon : !step.answer.trim())) return
    const request = captureStepRequest(step)
    const prefix = steps.slice(0, cursor)
    if (manual || request.horizon === 'this-week') {
      accept(
        request,
        {
          ...result!,
          ...localResult(request),
          understanding: result!.understanding,
          sources: result!.sources,
          contextLimited: result!.contextLimited,
        },
        prefix,
      )
    } else void analyze(request, prefix)
  }
  const skip = () => {
    if (!step || !question || locked || thinking) return
    const answer =
      question.field === 'outcome'
        ? 'Keep the outcome as stated in my intention.'
        : 'Use what is already known; I have nothing to add right now.'
    const updated = { ...step, answer }
    drafts.current.set(answerKey(step), answer)
    const prefix = [...steps.slice(0, cursor - 1), updated]
    setSteps(prefix)
    const request = captureStepRequest(updated)
    if (manual) accept(request, localResult(request), prefix)
    else void analyze(request, prefix)
  }
  const withoutSky = () => {
    const prior = lastRequest.current
    if (!prior) return
    cancel()
    setManual(true)
    setAssist(false)
    setError('')
    accept(prior.request, localResult(prior.request), prior.prefix)
  }
  const keySubmit = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      (!touch || event.ctrlKey || event.metaKey) &&
      !event.repeat &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    ) {
      event.preventDefault()
      next()
    }
  }
  const touchStart = (event: TouchEvent) => {
    swipe.current = null
    if (
      locked ||
      thinking ||
      event.touches.length !== 1 ||
      (event.target as HTMLElement).closest('input, textarea, button, a, nav, details, [contenteditable], label')
    )
      return
    const point = event.touches[0]!
    swipe.current = { x: point.clientX, y: point.clientY }
  }
  const touchMove = (event: TouchEvent) => {
    if (!swipe.current) return
    const point = event.touches[0]
    if (
      !point ||
      event.touches.length !== 1 ||
      Math.abs(point.clientY - swipe.current.y) > Math.max(24, Math.abs(point.clientX - swipe.current.x))
    )
      swipe.current = null
  }
  const touchEnd = (event: TouchEvent) => {
    const start = swipe.current
    swipe.current = null
    const end = event.changedTouches[0]
    if (!start || !end || event.touches.length) return
    const dx = end.clientX - start.x
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(end.clientY - start.y) * 2) move(cursor + (dx < 0 ? 1 : -1))
  }
  const save = async () => {
    if (!step || question || !outcome.trim() || outcome.trim().length > 2400 || savePending.current || busy) return
    if (!saveAttempt.current) {
      const forWeek = result!.horizon === 'this-week'
      saveAttempt.current = {
        forWeek,
        payload: forWeek
          ? { requestId: requestId.current, text: outcome.trim() }
          : {
              requestId: requestId.current,
              intent,
              title: Array.from(outcome.trim().split('\n')[0]!).slice(0, 160).join(''),
              outcome: outcome.trim(),
              understanding: result!.understanding,
              notes: [
                'Timing: ' + result!.horizonLabel,
                ...step.request.answers
                  .filter((item) => item.field !== 'timing')
                  .map((item) => item.question + '\n' + item.answer),
              ].join('\n\n'),
              sources: result!.sources.map((source) => ({ ...source, sensitive: true })),
              ...(parentId ? { parentId } : {}),
              sky: { mode: assist ? 'assist' : 'off' },
            },
      }
    }
    // A lost response must retry the same operation, never a revised wizard branch.
    const attempt = saveAttempt.current
    savePending.current = true
    setSaveLocked(true)
    setSaving(true)
    setError('')
    try {
      if (attempt.forWeek) {
        const response = await fetch('/week/_api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.payload),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? body.message ?? 'Could not add this to your week.')
        onOpenWeek(body.id)
      } else await onCreate(attempt.payload)
    } catch (problem) {
      setError(
        (problem instanceof Error ? problem.message : 'Could not confirm saving.') +
          ' Retry to finish saving the same work.',
      )
    } finally {
      savePending.current = false
      setSaving(false)
    }
  }
  const title = thinking
    ? 'Sky is catching up…'
    : !cursor
      ? 'What do you want to get done?'
      : question?.field === 'timing'
        ? timingQuestion.prompt
        : question
          ? 'A little clarity'
          : result?.horizon === 'this-week'
            ? 'Add this to your week'
            : parentId
              ? 'Start a sub-workstream'
              : 'Your starting point'
  const labels = ['Intention', ...steps.map(stepLabel)]
  const ready = Boolean(step && !question && !thinking)
  const canContinue = !cursor
    ? Boolean(intent.trim())
    : question?.field === 'timing'
      ? Boolean(step?.horizon)
      : Boolean(step?.answer.trim())

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={title}
      size="md"
      withCloseButton={!saving}
      closeOnEscape={!saving}
      closeOnClickOutside={!thinking && !saving}
    >
      <div
        className="sky-workstream-capture-flow"
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onTouchCancel={() => {
          swipe.current = null
        }}
      >
        <nav className="sky-workstream-capture-progress" aria-label="Workstream setup steps">
          {labels.map((label, index) => (
            <button
              type="button"
              key={index}
              aria-current={cursor === index ? 'step' : undefined}
              onClick={() => move(index)}
              disabled={locked}
            >
              {label}
            </button>
          ))}
          {labels.at(-1) !== 'Review' && (
            <button type="button" disabled>
              Review
            </button>
          )}
        </nav>
        {thinking ? (
          <div className="sky-workstream-capture-reading" role="status">
            <p className="sky-workstream-capture-intent">{intent}</p>
            <div className="sky-workstream-capture-status">
              <Loader size="sm" aria-hidden="true" />
              <p>Reading relevant notes and finding what still needs your input.</p>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <p className="sky-workstream-capture-error" role="alert">
                {error}
              </p>
            )}
            {!cursor && (
              <Textarea
                ref={answerInput}
                aria-label="What do you want to get done?"
                placeholder="Tell Sky what you have in mind…"
                autosize
                minRows={3}
                maxRows={7}
                maxLength={20000}
                value={intent}
                onChange={(event) => changeIntent(event.currentTarget.value)}
                onKeyDown={keySubmit}
                enterKeyHint={touch ? 'enter' : 'send'}
                disabled={locked}
              />
            )}
            {question?.field === 'timing' && (
              <div className="sky-workstream-capture-question">
                <p className="sky-workstream-capture-intent">{intent}</p>
                <div className="sky-workstream-capture-choices">
                  {horizons.map((choice) => (
                    <Button
                      key={choice.value}
                      aria-pressed={step?.horizon === choice.value}
                      disabled={locked}
                      onClick={() => changeAnswer(choice.label, choice.value)}
                    >
                      {choice.label}
                      <span aria-hidden="true">{step?.horizon === choice.value ? '✓' : ''}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {question && question.field !== 'timing' && (
              <div className="sky-workstream-capture-question">
                <h3>{question.prompt}</h3>
                <Textarea
                  ref={answerInput}
                  aria-label={question.prompt}
                  placeholder="A sentence is enough…"
                  autosize
                  minRows={2}
                  maxRows={5}
                  maxLength={4000}
                  value={step!.answer}
                  onChange={(event) => changeAnswer(event.currentTarget.value)}
                  enterKeyHint={touch ? 'enter' : 'send'}
                  onKeyDown={keySubmit}
                  disabled={locked}
                />
                {question.choices.length > 0 && (
                  <div className="sky-workstream-capture-suggestions">
                    {question.choices.map((choice) => (
                      <Button
                        key={choice.value}
                        onClick={() => changeAnswer(choice.value)}
                        aria-pressed={step!.answer === choice.value}
                        disabled={locked}
                      >
                        {choice.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {question && question.field !== 'timing' && <CaptureContext result={result!} />}
            {ready && (
              <div className="sky-workstream-capture-review">
                <div className="sky-workstream-capture-review-label">
                  <span>Outcome</span>
                  {!editing && (
                    <Button onClick={() => setEditing(true)} disabled={locked}>
                      Edit outcome
                    </Button>
                  )}
                </div>
                {editing ? (
                  <div className="sky-workstream-capture-edit">
                    <Textarea
                      label="Outcome"
                      autosize
                      minRows={2}
                      maxRows={7}
                      value={outcome}
                      onChange={(event) => setOutcome(event.currentTarget.value)}
                      disabled={locked}
                    />
                    {result?.suggestedOutcome && result.suggestedOutcome !== outcome && (
                      <div className="sky-workstream-capture-suggestion">
                        <span>Suggested wording</span>
                        <p>{result.suggestedOutcome}</p>
                        <Button onClick={() => setOutcome(result.suggestedOutcome!)} disabled={locked}>
                          Use suggested wording
                        </Button>
                      </div>
                    )}
                    <Button onClick={() => setEditing(false)}>Done editing</Button>
                  </div>
                ) : (
                  <p className="sky-workstream-capture-outcome">{outcome}</p>
                )}
                {!editing && result?.suggestedOutcome && result.suggestedOutcome !== outcome && (
                  <Button className="sky-workstream-capture-sharpen" onClick={() => setEditing(true)} disabled={locked}>
                    Sharpen wording
                  </Button>
                )}
                {outcome.trim().length > 2400 && (
                  <p role="alert" className="sky-workstream-capture-hint">
                    Shorten the outcome to 2,400 characters before saving. Your full intention is preserved.
                  </p>
                )}
                <div className="sky-workstream-capture-review-timing">
                  <span>Timing</span>
                  <Button disabled={locked} onClick={() => move(1)}>
                    {result!.horizonLabel} · Change
                  </Button>
                </div>
                {result?.horizon === 'this-week' ? (
                  <p className="sky-workstream-capture-hint">This will go into your week plan.</p>
                ) : (
                  <Checkbox
                    checked={assist}
                    onChange={(event) => setAssist(event.currentTarget.checked)}
                    label="Let Sky check in and prepare next steps"
                    disabled={locked}
                  />
                )}
                <CaptureContext result={result!} />
              </div>
            )}
          </>
        )}
        <div className="sky-workstream-capture-navigation">
          {(cursor > 0 || thinking) && (
            <Button disabled={locked} onClick={() => move(thinking ? cursor : cursor - 1)}>
              Back
            </Button>
          )}
          <div className="sky-workstream-capture-actions">
            {error && !saveLocked ? (
              <>
                <Button onClick={withoutSky}>Continue without Sky</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const prior = lastRequest.current
                    if (prior) void analyze(prior.request, prior.prefix)
                  }}
                >
                  Try again
                </Button>
              </>
            ) : thinking ? (
              <Button onClick={close}>Cancel</Button>
            ) : ready ? (
              <Button
                variant="primary"
                loading={saving}
                onClick={() => void save()}
                disabled={busy || !outcome.trim() || outcome.trim().length > 2400}
              >
                {saveLocked && error
                  ? 'Retry saving'
                  : result?.horizon === 'this-week'
                    ? 'Add to this week'
                    : 'Start workstream'}
              </Button>
            ) : (
              <>
                {question && question.field !== 'timing' && (
                  <Button disabled={locked} onClick={skip}>
                    {question.field === 'outcome' ? 'Keep it broad' : 'Nothing to add'}
                  </Button>
                )}
                <Button variant="primary" disabled={locked || !canContinue} onClick={next}>
                  Continue
                </Button>
              </>
            )}
          </div>
        </div>
        {touch && steps.length > 0 && <p className="sky-workstream-capture-swipe-hint">Swipe to revisit a step.</p>}
      </div>
    </Modal>
  )
}

function CaptureContext({ result }: { result: CaptureResponse }) {
  if (!result.understanding && !result.sources.length && !result.contextLimited) return null
  return (
    <details className="sky-workstream-capture-sources">
      <summary>Context Sky found</summary>
      {result.understanding && <p>{result.understanding}</p>}
      {result.sources.length > 0 && (
        <span>
          Based on {result.sources.length} {result.sources.length === 1 ? 'note' : 'notes'}
        </span>
      )}
      {result.sources.map((source) => (
        <a key={source.id} href={fileHref(source.path)} target="_blank" rel="noreferrer">
          {source.label || source.path}
        </a>
      ))}
      {result.contextLimited && <p>Sky used a selection of recent, relevant notes. Some context may be missing.</p>}
    </details>
  )
}
