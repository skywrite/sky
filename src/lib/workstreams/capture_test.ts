import { spyOn } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import * as models from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { captureWorkstream, resolveCapture, type CaptureContext } from './capture.ts'
import { CAPTURE_HORIZON_CHOICES, CaptureResponseSchema, type CaptureRequest } from './captureTypes.ts'

const today = new PlainDate('2025-03-15')
const intent = 'Help Atlas expand the pilot.'
const context: CaptureContext = {
  sources: [
    {
      id: 'source-1',
      path: 'time/pilot-notes.md',
      label: 'Pilot notes',
      content: 'Atlas has two customers evaluating the existing pilot.',
    },
  ],
  limited: false,
}
const proposal = {
  title: 'Expand the Atlas pilot',
  outcome: 'Bring more customers into the pilot.',
  understanding: 'Two customers are evaluating the existing pilot.',
  horizon: null,
  horizonEvidence: null,
  situationKnown: true,
  question: null,
  sourceIds: ['source-1'],
}
const publicSituationQuestion = { field: 'situation', prompt: 'Where are things today?', choices: [] }
const situationQuestion = { ...publicSituationQuestion, basis: 'missing-context', evidence: '' }

test('capture preserves broad owner wording and title scope even when the model imports a source target', () => {
  const original = '  Raise funding for Atlas.\nKeep the target open for now.  '
  const model = {
    ...proposal,
    title: 'Raise $8M for Atlas by Friday',
    outcome: 'Raise $8M for Atlas by Friday.',
    understanding: 'A prior planning note mentions an $8M target.',
    horizon: 'this-week',
    horizonEvidence: 'Raise $8M for Atlas by Friday.',
  }
  const result = resolveCapture({ intent: original, answers: [] }, model, {
    ...context,
    sources: [{ ...context.sources[0]!, content: 'Raise $8M for Atlas by Friday.' }],
  })
  assert({
    given: 'a broad intention and a model response that imports an amount and date from old notes',
    should: 'keep the owner’s exact outcome and title scope while exposing alternate wording only as a suggestion',
    actual: [
      result.outcome,
      result.title,
      result.suggestedOutcome,
      result.horizon,
      result.question?.field,
      result.understanding,
    ],
    expected: [original.trim(), 'Raise funding for Atlas.', model.outcome, null, 'timing', model.understanding],
  })
})

test('explicit owner targets and later clarifications are preserved without automatic replacement', () => {
  const original = 'Raise $2M for Atlas over the next three months.'
  const unchanged = resolveCapture(
    { intent: original, answers: [] },
    { ...proposal, outcome: original, horizon: 'few-months', horizonEvidence: 'over the next three months' },
    context,
  )
  const clarified = resolveCapture(
    {
      intent: 'Raise funding for Atlas.',
      horizon: 'few-months',
      answers: [{ field: 'outcome', question: 'What funding target do you want?', answer: 'We want to raise $2M.' }],
    },
    { ...proposal, outcome: 'Raise $2M for Atlas.' },
    context,
  )
  const whitespace = resolveCapture(
    { intent: 'Raise funding\nfor Atlas.', answers: [] },
    { ...proposal, outcome: 'Raise funding for Atlas.' },
    context,
  )
  assert({
    given: 'an explicit target, a later clarification, and a formatting-only rewrite',
    should: 'retain original intent and represent substantive clarified wording as a separate choice',
    actual: [
      unchanged.outcome,
      unchanged.title,
      unchanged.suggestedOutcome,
      unchanged.horizon,
      clarified.outcome,
      clarified.suggestedOutcome,
      whitespace.outcome,
      whitespace.suggestedOutcome,
    ],
    expected: [
      original,
      original,
      null,
      'few-months',
      'Raise funding for Atlas.',
      'Raise $2M for Atlas.',
      'Raise funding\nfor Atlas.',
      null,
    ],
  })
})

test('long owner intentions remain intact through intake and older response fixtures remain compatible', () => {
  const firstLine = 'x'.repeat(159) + '🚀'
  const original = `${firstLine}\n${'Preserve the scope and conditions exactly. '.repeat(100)}`.trim()
  const result = resolveCapture({ intent: original, answers: [] }, { ...proposal, outcome: null }, context)
  const { suggestedOutcome: _suggestion, ...olderResponse } = result
  assert({
    given: 'an intention longer than a workstream outcome field and a host without the new suggestion field',
    should:
      'preserve all owner text for review, cap the title without breaking a character, and accept the older response',
    actual: [
      result.outcome,
      result.title,
      result.suggestedOutcome,
      CaptureResponseSchema.safeParse(olderResponse).success,
    ],
    expected: [original, 'x'.repeat(159), null, true],
  })
})
const timedRequest: CaptureRequest = { intent, horizon: 'few-weeks', answers: [] }

test('known context skips repetitive status questions while missing timing comes first', () => {
  const known = resolveCapture(timedRequest, { ...proposal, question: situationQuestion }, context)
  const unknown = resolveCapture(
    { intent, answers: [] },
    { ...proposal, horizon: null, situationKnown: false, question: situationQuestion },
    context,
  )
  assert({
    given: 'useful current notebook context and an intention whose timing is sometimes unspecified',
    should: 'acknowledge known facts and ask only timing first when it is missing',
    actual: [known.question, known.understanding, unknown.horizon, unknown.question],
    expected: [
      null,
      proposal.understanding,
      null,
      { field: 'timing', prompt: 'What time frame do you have in mind?', choices: CAPTURE_HORIZON_CHOICES },
    ],
  })
})

test('notebook completion dates cannot select timing or route an untimed intention into the week', () => {
  const source = { ...context.sources[0]!, content: 'Complete the pilot rollout this week.' }
  const result = resolveCapture(
    { intent, answers: [] },
    { ...proposal, horizon: 'this-week', horizonEvidence: source.content },
    { ...context, sources: [source] },
  )
  assert({
    given: 'an untimed user intention and a model treating a current week plan as a completion deadline',
    should: 'leave timing unset and ask the owner instead of offering weekly capture',
    actual: [result.horizon, result.horizonLabel, result.question?.field],
    expected: [null, 'Timing not set', 'timing'],
  })
})

test('the owner controls timing and a weekly outcome ends intake immediately', () => {
  const owner = resolveCapture({ intent, horizon: 'longer-term', answers: [] }, proposal, context)
  const weekly = resolveCapture(
    { intent, horizon: 'this-week', answers: [] },
    { ...proposal, situationKnown: false, question: situationQuestion },
    context,
  )
  const answer = resolveCapture(
    { intent, answers: [{ field: 'timing', question: 'When?', answer: 'This week' }] },
    { ...proposal, question: situationQuestion },
    context,
  )
  const unsure = resolveCapture(
    { intent, answers: [{ field: 'timing', question: 'When?', answer: 'I don’t know yet.' }] },
    proposal,
    context,
  )
  assert({
    given: 'explicit timing that differs from model inference, including an uncertain answer',
    should: 'respect the owner and finish immediately for this week without asking a workstream questionnaire',
    actual: [
      owner.horizon,
      weekly.horizon,
      weekly.question,
      answer.horizon,
      answer.question,
      unsure.horizon,
      unsure.question,
    ],
    expected: ['longer-term', 'this-week', null, 'this-week', null, 'unsure', null],
  })
})

test('broad answers count as answers and three clarifications is a hard maximum', () => {
  const answered: CaptureRequest['answers'] = [
    {
      field: 'outcome',
      question: 'What would help?',
      answer: 'I just want it to grow; I do not know the exact target.',
    },
  ]
  const result = resolveCapture(
    { ...timedRequest, answers: answered },
    {
      ...proposal,
      question: {
        field: 'outcome',
        prompt: 'What exact measurable target?',
        choices: [],
        basis: 'missing-context',
        evidence: '',
      },
    },
    context,
  )
  const capped = resolveCapture(
    { intent, answers: [...answered, ...answered, ...answered] },
    { ...proposal, horizon: null, question: situationQuestion },
    context,
  )
  const missingSituation = resolveCapture(
    { intent, horizon: 'unsure', answers: [] },
    { ...proposal, situationKnown: false, understanding: '', sourceIds: [], question: situationQuestion },
    { sources: [], limited: false },
  )
  assert({
    given: 'a broad outcome answer, three prior answers, and a fresh notebook without known context',
    should: 'avoid demanding precision, enforce the cap and allow one useful situation question when context is absent',
    actual: [result.question, capped.question, missingSituation.question],
    expected: [null, null, publicSituationQuestion],
  })
})

test('capture returns only consulted source metadata and preserves limited coverage', () => {
  const result = resolveCapture(
    { intent, answers: [] },
    { ...proposal, sourceIds: ['invented', 'source-1', 'source-1'] },
    { ...context, limited: true },
  )
  assert({
    given: 'model source IDs containing an unknown reference and a duplicate',
    should: 'return verified metadata once without echoing source contents or inventing paths',
    actual: [result.sources, result.contextLimited],
    expected: [[{ id: 'source-1', path: 'time/pilot-notes.md', label: 'Pilot notes' }], true],
  })
})

test('known situations can surface a grounded specific gap or conflict without a broad status interview', () => {
  const quote = 'two customers evaluating the existing pilot'
  const question = {
    field: 'situation',
    prompt: 'What do those customers need to validate before the pilot expands?',
    choices: [],
  }
  const gap = resolveCapture(
    timedRequest,
    { ...proposal, question: { ...question, basis: 'specific-gap', evidence: quote } },
    context,
  )
  const invented = resolveCapture(
    timedRequest,
    { ...proposal, question: { ...question, basis: 'specific-gap', evidence: 'The pilot was rejected.' } },
    context,
  )
  const uncited = resolveCapture(
    timedRequest,
    { ...proposal, sourceIds: ['invented-source'], question: { ...question, basis: 'specific-gap', evidence: quote } },
    context,
  )
  const conflictingContext = {
    ...context,
    sources: [
      { ...context.sources[0]!, content: 'Legal records approval; operations still lists approval as pending.' },
    ],
  }
  const conflictQuestion = {
    field: 'situation',
    prompt: 'Is approval complete, or does operations still need something?',
    choices: [],
  }
  const conflict = resolveCapture(
    timedRequest,
    {
      ...proposal,
      question: { ...conflictQuestion, basis: 'conflict', evidence: conflictingContext.sources[0]!.content },
    },
    conflictingContext,
  )
  assert({
    given: 'useful context containing a consequential gap or conflicting state',
    should: 'allow a specific evidence-backed question and suppress questions grounded in invented or uncited facts',
    actual: [gap.question, invented.question, uncited.question, conflict.question],
    expected: [question, null, null, conflictQuestion],
  })
})

test('capture rejects unusable or expanded model output', () => {
  const candidates = [
    { ...proposal, title: '' },
    { ...proposal, outcome: 'x'.repeat(501) },
    { ...proposal, understanding: 'x'.repeat(281) },
    { ...proposal, question: { field: 'timing', prompt: 'A repeated question?', choices: [] } },
    { ...proposal, tasks: ['An unsolicited plan'] },
  ]
  assert({
    given: 'missing content, excessive prose, a model timing question or an unsolicited task list',
    should: 'reject the response before showing it as a usable starting point',
    actual: candidates.map((value) => {
      try {
        resolveCapture({ intent, answers: [] }, value, context)
        return false
      } catch {
        return true
      }
    }),
    expected: [true, true, true, true, true],
  })
})

test('every specific gap or conflict requires evidence regardless of field or known situation', () => {
  const question = { prompt: 'What changed?', choices: [], evidence: 'The board rejected the pilot.' }
  const outcome = resolveCapture(
    timedRequest,
    { ...proposal, question: { ...question, field: 'outcome', basis: 'specific-gap' } },
    context,
  )
  const situation = resolveCapture(
    timedRequest,
    { ...proposal, situationKnown: false, question: { ...question, field: 'situation', basis: 'conflict' } },
    { sources: [], limited: false },
  )
  const broad = resolveCapture(
    timedRequest,
    { ...proposal, situationKnown: false, question: situationQuestion },
    { sources: [], limited: false },
  )
  assert({
    given:
      'an unsupported outcome gap, an unsupported conflict in an unknown situation, and a broad missing-context question',
    should: 'suppress every unsupported specific claim while allowing useful ordinary clarification',
    actual: [outcome.question, situation.question, broad.question],
    expected: [null, null, publicSituationQuestion],
  })
})

function modelReturning(value: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(value) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
}

test('conversational capture uses a short request-local profile and the grounded notebook context', async () => {
  const profile = models.defineProfile({
    provider: 'cerebras',
    model: 'qwen-3.8-27b',
    options: { reasoningEffort: 'high' },
  })
  const model = modelReturning(proposal)
  const selected = spyOn(models, 'getProfile').mockReturnValue(profile)
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model })
  try {
    const input: CaptureRequest = {
      intent,
      horizon: 'few-months',
      answers: [
        { field: 'situation', question: 'Where are things today?', answer: 'The pilot now has three customers.' },
      ],
    }
    const result = await captureWorkstream(input, context, today)
    const call = model.doGenerateCalls[0]!
    const instructions = call.prompt.find((entry) => entry.role === 'system')?.content ?? ''
    const userMessage = call.prompt
      .find((entry) => entry.role === 'user')
      ?.content.find((entry) => entry.type === 'text')
    assert({
      given: 'a configured fast profile, saved context and a newer user answer',
      should:
        'use shared resolution with a small output budget and pass the actual current context with grounding instructions',
      actual: [
        selected.mock.calls[0],
        resolved.mock.calls[0],
        profile.options?.reasoningEffort,
        result.horizon,
        userMessage?.type === 'text' ? JSON.parse(userMessage.text) : null,
        typeof instructions === 'string' && instructions.includes('Never guess a company type from its name.'),
        typeof instructions === 'string' && instructions.includes('Later answers override older notebook notes.'),
      ],
      expected: [
        ['default-cerebras-qwen-3.8'],
        [
          { ...profile, options: { reasoningEffort: 'none' } },
          { maxRetries: 0, maxOutputTokens: 1400 },
        ],
        'high',
        'few-months',
        { ...input, today: today.ymd, sources: context.sources, contextLimited: false },
        true,
        true,
      ],
    })
    const alternative = models.defineProfile({
      provider: 'anthropic',
      model: 'configured-model',
      options: { effort: 'low' },
    })
    selected.mockReturnValue(alternative)
    await captureWorkstream(input, context, today)
    assert({
      given: 'an explicit replacement provider in the named profile',
      should: 'preserve its settings instead of applying Cerebras options',
      actual: resolved.mock.calls[1]?.[0],
      expected: alternative,
    })
  } finally {
    selected.mockRestore()
    resolved.mockRestore()
  }
})

test('capture aborts before model work and reports invalid responses without inventing success', async () => {
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'cerebras', model: 'qwen-3.8-27b' })
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({
    model: modelReturning({ ...proposal, title: '' }),
  })
  try {
    const controller = new AbortController()
    const reason = new DOMException('Canceled intake', 'AbortError')
    controller.abort(reason)
    const canceled = await captureWorkstream({ intent, answers: [] }, context, today, controller.signal).catch(
      (error: unknown) => error,
    )
    const before = resolved.mock.calls.length
    const invalid = await captureWorkstream({ intent, answers: [] }, context, today).catch((error: unknown) => error)
    assert({
      given: 'a canceled request and a model response missing its title',
      should: 'propagate cancellation without a call and report the failed response as unavailable',
      actual: [
        canceled === reason,
        before,
        (invalid as { status?: number }).status,
        invalid instanceof Error && invalid.message.includes('has not been saved'),
      ],
      expected: [true, 0, 503, true],
    })
  } finally {
    selected.mockRestore()
    resolved.mockRestore()
  }
})

test('canceling an in-flight capture reaches the model request', async () => {
  const controller = new AbortController()
  let started: () => void = () => {}
  const modelStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  const model = new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) => {
      started()
      return new Promise<never>((_resolve, reject) => {
        abortSignal!.addEventListener('abort', () => reject(abortSignal!.reason), { once: true })
      })
    },
  })
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'cerebras', model: 'qwen-3.8-27b' })
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model })
  try {
    const pending = captureWorkstream({ intent, answers: [] }, context, today, controller.signal)
    await modelStarted
    controller.abort(new DOMException('Canceled intake', 'AbortError'))
    const error = await pending.catch((failure: unknown) => failure)
    assert({
      given: 'a user canceling while the model is reviewing their intention',
      should: 'abort the provider request and return no starting point',
      actual: [model.doGenerateCalls[0]?.abortSignal?.aborted, error instanceof Error && error.name === 'AbortError'],
      expected: [true, true],
    })
  } finally {
    controller.abort()
    selected.mockRestore()
    resolved.mockRestore()
  }
})
