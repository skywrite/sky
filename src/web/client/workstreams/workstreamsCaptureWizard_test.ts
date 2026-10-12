import type { CaptureRequest, CaptureResponse } from '#lib/workstreams/captureTypes.ts'
import { assert, test } from '#test'
import { captureStepRequest, captureSteps, type CaptureStep } from './workstreamsCaptureWizard.ts'

const request: CaptureRequest = { intent: 'Launch the Atlas pilot over the next three months.', answers: [] }
const ready: CaptureResponse = {
  title: 'Atlas pilot',
  outcome: request.intent,
  suggestedOutcome: 'Launch a pilot with the first customers.',
  understanding: 'The pilot scope is already agreed.',
  horizon: 'few-months',
  horizonLabel: 'A few months',
  question: null,
  sources: [],
  contextLimited: false,
}

test('an initial ready response retains an editable timing step without rewriting the owner’s outcome', () => {
  const steps = captureSteps(request, ready, true)
  assert({
    given: 'an intention containing timing and enough context to skip the remaining questions',
    should: 'leave timing reachable in history while preserving the owner’s text and optional suggestion separately',
    actual: steps.map((step) => ({
      field: step.response.question?.field ?? null,
      outcome: step.response.outcome,
      suggestion: step.response.suggestedOutcome,
      selected: step.horizon,
      override: step.request.horizon ?? null,
      answer: step.answer,
    })),
    expected: [
      {
        field: 'timing',
        outcome: request.intent,
        suggestion: ready.suggestedOutcome,
        selected: 'few-months',
        override: null,
        answer: 'A few months',
      },
      {
        field: null,
        outcome: request.intent,
        suggestion: ready.suggestedOutcome,
        selected: 'few-months',
        override: null,
        answer: '',
      },
    ],
  })
})

test('timing history appears once and unknown timing never receives a default choice', () => {
  const timing: CaptureResponse = {
    ...ready,
    horizon: null,
    horizonLabel: 'Timing not set',
    question: { field: 'timing', prompt: 'When?', choices: [] },
  }
  const unknown = captureSteps(request, timing, true)
  const later = captureSteps(request, ready, false)
  const explicitQuestion = captureSteps(request, { ...timing, horizon: 'few-months' }, true)
  assert({
    given: 'unknown timing, a subsequent ready response, and an initial response already asking timing',
    should: 'avoid invented defaults or duplicate timing steps',
    actual: [unknown.length, unknown[0]!.horizon, unknown[0]!.answer, later.length, explicitQuestion.length],
    expected: [1, undefined, '', 1, 1],
  })
})

test('answering another question cannot turn inferred timing into an explicit override', () => {
  const response: CaptureResponse = {
    ...ready,
    question: { field: 'situation', prompt: 'Is approval still outstanding?', choices: [] },
  }
  const step: CaptureStep = { ...captureSteps(request, response, false)[0]!, answer: 'Approval came through.' }
  const automatic = captureStepRequest(step)
  const selected = captureStepRequest({ ...step, request: { ...request, horizon: 'longer-term' } })
  assert({
    given: 'a non-timing answer with a displayed model horizon and a different earlier user selection',
    should: 'send only actual user horizon overrides and the current answer',
    actual: [automatic, selected.horizon],
    expected: [
      {
        ...request,
        answers: [{ field: 'situation', question: 'Is approval still outstanding?', answer: 'Approval came through.' }],
      },
      'longer-term',
    ],
  })
})

test('changing a visited timing answer replaces the old answer and controls the new destination', () => {
  const previous: CaptureRequest = {
    ...request,
    horizon: 'few-months',
    answers: [
      { field: 'outcome', question: 'What would success look like?', answer: 'A useful pilot.' },
      { field: 'timing', question: 'When?', answer: 'A few months' },
    ],
  }
  const step = captureSteps(previous, ready, true)[0]!
  const revised = captureStepRequest({ ...step, horizon: 'this-week', answer: 'stale cached label' })
  const resubmitted = captureStepRequest({ ...step, request: revised, horizon: 'this-week' })
  assert({
    given: 'the owner revisiting timing and selecting this week before continuing again',
    should: 'replace the same field rather than duplicate it or retain the old destination',
    actual: [revised, resubmitted.answers.length, previous.horizon, previous.answers[1]!.answer],
    expected: [
      {
        ...previous,
        horizon: 'this-week',
        answers: [
          previous.answers[0],
          { field: 'timing', question: step.response.question!.prompt, answer: 'This week' },
        ],
      },
      2,
      'few-months',
      'A few months',
    ],
  })
})

test('ready snapshots and an unselected timing step cannot fabricate a submitted answer', () => {
  const readyStep = captureSteps(request, ready, false)[0]!
  const timingStep: CaptureStep = {
    ...readyStep,
    horizon: undefined,
    answer: '',
    response: { ...ready, horizon: null, question: { field: 'timing', prompt: 'When?', choices: [] } },
  }
  assert({
    given: 'navigation through ready history or a timing page with no selection',
    should: 'leave the request untouched until an answer is explicitly submitted',
    actual: [captureStepRequest(readyStep) === request, captureStepRequest(timingStep) === request],
    expected: [true, true],
  })
})
