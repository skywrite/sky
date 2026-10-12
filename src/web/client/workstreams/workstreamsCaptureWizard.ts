import {
  CAPTURE_HORIZON_CHOICES,
  type CaptureHorizon,
  type CaptureRequest,
  type CaptureResponse,
} from '#lib/workstreams/captureTypes.ts'

export type CaptureStep = {
  request: CaptureRequest
  response: CaptureResponse
  answer: string
  horizon?: CaptureHorizon
}

export function captureSteps(request: CaptureRequest, response: CaptureResponse, initial: boolean): CaptureStep[] {
  const horizon = response.horizon ?? undefined
  const label = CAPTURE_HORIZON_CHOICES.find((choice) => choice.value === horizon)?.label ?? ''
  const step: CaptureStep = {
    request,
    response,
    answer:
      response.question?.field === 'timing'
        ? label
        : (request.answers.findLast((answer) => answer.field === response.question?.field)?.answer ?? ''),
    horizon,
  }
  if (!initial || !horizon || response.question?.field === 'timing') return [step]
  // Timing supplied in the intention is still a visited, editable step in the wizard.
  return [
    {
      request,
      response: {
        ...response,
        question: {
          field: 'timing',
          prompt: 'Roughly when do you want this done?',
          choices: CAPTURE_HORIZON_CHOICES,
        },
      },
      answer: label,
      horizon,
    },
    step,
  ]
}

export function captureStepRequest(step: CaptureStep): CaptureRequest {
  const question = step.response.question
  if (!question) return step.request
  const timing = question.field === 'timing'
  const answer = timing ? CAPTURE_HORIZON_CHOICES.find((choice) => choice.value === step.horizon)?.label : step.answer
  if (answer === undefined) return step.request
  return {
    ...step.request,
    answers: [
      ...step.request.answers.filter((previous) => previous.field !== question.field),
      { field: question.field, question: question.prompt, answer },
    ],
    // Displaying inferred timing does not make it an explicit user selection on another step.
    ...(timing && step.horizon ? { horizon: step.horizon } : {}),
  }
}
