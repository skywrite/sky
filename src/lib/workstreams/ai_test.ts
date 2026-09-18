import { spyOn } from 'bun:test'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import * as models from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { assessWorkstreamAction, draftWorkstream, prepareWorkstreamReport, proposeWorkstream } from './ai.ts'
import { WorkstreamError } from './types.ts'

const draft = {
  title: 'Prepare the Atlas pilot',
  outcome: 'Agree on a useful pilot scope.',
  understanding: 'The owner wants a clear starting point.',
  unknowns: ['Which customers should participate?'],
  activities: [],
  decisions: [],
  relationships: [],
  suggestions: [],
  subworkstreams: [],
}

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

const review = {
  summary: 'The pilot needs a scope decision.',
  understanding: 'The owner is preparing a pilot.',
  outcomeSuggestion: '',
  unknowns: [],
  activities: [],
  decisions: [],
  relationships: [],
  suggestions: [],
  subworkstreams: [],
  artifact: null,
  communication: null,
  waitingFor: 'The owner’s scope decision.',
  nextCheckMinutes: 1440,
}

function completion(
  text: string,
  finishReason: 'stop' | 'length' | 'content-filter' = 'stop',
): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: finishReason, raw: finishReason },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
}

test('ongoing review, reporting and independent verification share the configured Astra profile', async () => {
  const profile = models.defineProfile({
    provider: 'openai',
    model: 'gpt-6-astra',
    options: { reasoningEffort: 'high', serviceTier: 'priority' },
  })
  const report = { title: 'Pilot update', body: 'Scope needs an owner decision.', missingInputs: [] }
  const assessment = {
    satisfied: false,
    rationale: 'The required scope decision is absent.',
    artifactEvidence: [],
    sourceEvidence: [],
    missingInputs: ['An agreed pilot scope.'],
    requiresExternalResult: false,
  }
  const model = new MockLanguageModelV4({
    doGenerate: [
      completion(JSON.stringify({ ...review, coordination: null, decisionAssessments: null })),
      completion(JSON.stringify(report)),
      completion(JSON.stringify(assessment)),
    ],
  })
  const selected = spyOn(models, 'getProfile').mockReturnValue(profile)
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model })
  try {
    const results = [
      await proposeWorkstream({ outcome: 'Prepare the Atlas pilot.' }),
      await prepareWorkstreamReport({ outcome: 'Prepare the Atlas pilot.' }),
      await assessWorkstreamAction({ outcome: 'Prepare the Atlas pilot.' }),
    ]
    assert({
      given: 'a saved workstream needing review, an update and deliverable verification',
      should: 'use Astra for each call, request structured output and restore absent optional fields',
      actual: [
        selected.mock.calls,
        resolved.mock.calls,
        model.doGenerateCalls.map((call) => call.responseFormat?.type),
        results,
      ],
      expected: [
        Array.from({ length: 3 }, () => ['default-gpt-6-astra-high']),
        Array.from({ length: 3 }, () => [profile, { maxRetries: 0, maxOutputTokens: 16_000 }]),
        ['json', 'json', 'json'],
        [review, report, assessment],
      ],
    })
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('the ongoing named profile can be overridden with Fable without changing its provider settings', async () => {
  const profile = models.defineProfile({
    provider: 'anthropic',
    model: 'claude-fable-5-1',
    options: { effort: 'high', thinking: { type: 'adaptive' } },
  })
  const selected = spyOn(models, 'getProfile').mockReturnValue(profile)
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model: modelReturning(review) })
  try {
    await proposeWorkstream({ outcome: 'Prepare the Atlas pilot.' })
    assert({
      given: 'a named ongoing model override pointing at Fable',
      should: 'use the configured model and its reasoning options unchanged',
      actual: resolved.mock.calls[0]?.[0],
      expected: profile,
    })
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('malformed, truncated and locally invalid review outputs get one fresh generation before any proposal returns', async () => {
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'openai', model: 'gpt-6-astra' })
  const resolved = spyOn(models, 'resolveProfile')
  try {
    for (const invalid of [
      completion('{"activities":[}'),
      completion('{"activities":[', 'length'),
      completion(JSON.stringify({ ...review, nextCheckMinutes: 1 })),
      completion(JSON.stringify(review), 'length'),
    ]) {
      const model = new MockLanguageModelV4({ doGenerate: [invalid, completion(JSON.stringify(review))] })
      resolved.mockReturnValue({ model })
      const signal = AbortSignal.timeout(60_000)
      const result = await proposeWorkstream({ outcome: 'Prepare the Atlas pilot.' }, signal)
      assert({
        given: `a response finishing as ${invalid.finishReason.unified} that is invalid or incomplete`,
        should: 'discard it and return only the validated retry under the same deadline',
        actual: [
          result,
          model.doGenerateCalls.length,
          model.doGenerateCalls.map((call) => call.abortSignal === signal),
          JSON.stringify(model.doGenerateCalls[1]!.prompt).includes('Regenerate a compact complete result'),
          model.doGenerateCalls[0]!.prompt.find((message) => message.role === 'user')?.content,
        ],
        expected: [review, 2, [true, true], true, [{ type: 'text', text: '{"outcome":"Prepare the Atlas pilot."}' }]],
      })
    }
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('repeated invalid output stops after two calls with a useful error instead of raw JSON or model content', async () => {
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'openai', model: 'gpt-6-astra' })
  const resolved = spyOn(models, 'resolveProfile')
  try {
    for (const reason of ['stop', 'length'] as const) {
      const model = new MockLanguageModelV4({ doGenerate: completion('{"private-source-fragment":[', reason) })
      resolved.mockReturnValue({ model })
      const error = await proposeWorkstream({}).catch((error: unknown) => error)
      assert({
        given: `two unusable responses with finish reason ${reason}`,
        should: 'stop regeneration and explain whether the response was invalid or cut off',
        actual: [
          model.doGenerateCalls.length,
          error instanceof WorkstreamError && error.status,
          error instanceof Error && error.message,
        ],
        expected: [
          2,
          503,
          reason === 'length'
            ? 'Sky’s response was cut off twice. Try again with a smaller next step.'
            : 'Sky could not produce a usable workstream response after retrying. Try again.',
        ],
      })
    }
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('provider errors, refusal and cancellation are not retried as malformed output', async () => {
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'openai', model: 'gpt-6-astra' })
  const resolved = spyOn(models, 'resolveProfile')
  try {
    const providerError = new Error('Provider unavailable')
    const providerModel = new MockLanguageModelV4({
      doGenerate: () => {
        throw providerError
      },
    })
    resolved.mockReturnValue({ model: providerModel })
    const failure = await proposeWorkstream({}).catch((error: unknown) => error)

    const refusalModel = new MockLanguageModelV4({ doGenerate: completion('', 'content-filter') })
    resolved.mockReturnValue({ model: refusalModel })
    const refusal = await proposeWorkstream({}).catch((error: unknown) => error)

    const controller = new AbortController()
    const cancelled = new Error('The owner cancelled this attempt.')
    const abortModel = new MockLanguageModelV4({
      doGenerate: async () => {
        controller.abort(cancelled)
        return completion('{"activities":[', 'length')
      },
    })
    resolved.mockReturnValue({ model: abortModel })
    const abort = await proposeWorkstream({}, controller.signal).catch((error: unknown) => error)
    assert({
      given: 'a provider outage, a filtered response and a cancelled malformed response',
      should: 'preserve failure or cancellation and avoid another generation',
      actual: [
        failure === providerError,
        refusal instanceof WorkstreamError,
        abort === cancelled,
        [providerModel, refusalModel, abortModel].map((model) => model.doGenerateCalls.length),
      ],
      expected: [true, true, true, [1, 1, 1]],
    })
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('initial capture uses fast Cerebras without mutating shared settings or overriding a different model', async () => {
  const profile = models.defineProfile({
    provider: 'cerebras',
    model: 'qwen-3.8-27b',
    contextWindow: 131_072,
    options: { reasoningEffort: 'high', maxOutputTokens: 9000 },
  })
  const selected = spyOn(models, 'getProfile').mockReturnValue(profile)
  const model = modelReturning(draft)
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model })
  try {
    const context = { objective: 'Prepare the Atlas pilot.' }
    const result = await draftWorkstream(context)
    assert({
      given: 'the shared Cerebras profile with reasoning enabled and an initial intention',
      should: 'tune only this request and pass the context through the standard model resolver',
      actual: [
        selected.mock.calls[0],
        resolved.mock.calls[0],
        profile.options?.reasoningEffort,
        model.doGenerateCalls[0]!.prompt.find((message) => message.role === 'user')?.content,
        result,
      ],
      expected: [
        ['default-cerebras-qwen-3.8'],
        [
          { ...profile, options: { ...profile.options, reasoningEffort: 'none' } },
          { maxRetries: 0, maxOutputTokens: 6000 },
        ],
        'high',
        [{ type: 'text', text: JSON.stringify(context) }],
        draft,
      ],
    })
    const alternative = models.defineProfile({
      provider: 'anthropic',
      model: 'configured-model',
      options: { effort: 'low' },
    })
    selected.mockReturnValue(alternative)
    await draftWorkstream(context)
    assert({
      given: 'a user override that points the named profile to a different provider and model',
      should: 'preserve its own provider options',
      actual: resolved.mock.calls[1]?.[0],
      expected: alternative,
    })
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})

test('initial capture rejects invalid model output before returning a proposal', async () => {
  const selected = spyOn(models, 'getProfile').mockReturnValue({ provider: 'cerebras', model: 'qwen-3.8-27b' })
  const resolved = spyOn(models, 'resolveProfile').mockReturnValue({ model: modelReturning({ ...draft, outcome: '' }) })
  try {
    const error = await draftWorkstream({ objective: 'Prepare the Atlas pilot.' }).then(
      () => null,
      (failure: unknown) => failure,
    )
    assert({
      given: 'a fast model response whose outcome is missing',
      should: 'retain local schema validation instead of accepting an unusable proposal',
      actual: error instanceof Error && error.name === 'ZodError',
      expected: true,
    })
  } finally {
    resolved.mockRestore()
    selected.mockRestore()
  }
})
