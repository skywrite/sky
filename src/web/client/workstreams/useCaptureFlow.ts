import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  CAPTURE_HORIZON_CHOICES as horizons,
  type CaptureHorizon,
  type CaptureRequest,
  type CaptureResponse,
} from '#lib/workstreams/captureTypes.ts'
import { captureSteps, captureStepRequest, type CaptureStep } from './captureWizard.ts'
import { workstreamRequest } from './request.ts'

export const timingQuestion: NonNullable<CaptureResponse['question']> = {
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

export type CaptureFlow = ReturnType<typeof useCaptureFlow>

// The capture wizard's state and moves: the intention, Sky's questions and the answers, the review, and saving.
export function useCaptureFlow({
  opened,
  initialIntent,
  parentId,
  busy,
  touch,
  onClose,
  onCreate,
  onOpenWeek,
}: {
  opened: boolean
  initialIntent: string
  parentId?: string
  busy: boolean
  touch: boolean
  onClose: () => void
  onCreate: (input: unknown) => Promise<void>
  onOpenWeek: (id: string) => void
}) {
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
  const retry = () => {
    const prior = lastRequest.current
    if (prior) void analyze(prior.request, prior.prefix)
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

  return {
    intent,
    outcome,
    setOutcome,
    steps,
    cursor,
    step,
    result,
    question,
    thinking,
    saving,
    error,
    assist,
    setAssist,
    editing,
    setEditing,
    saveLocked,
    locked,
    answerInput,
    title,
    labels,
    ready,
    canContinue,
    move,
    close,
    changeIntent,
    changeAnswer,
    next,
    skip,
    withoutSky,
    retry,
    keySubmit,
    save,
  }
}
