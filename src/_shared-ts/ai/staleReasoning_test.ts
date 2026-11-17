import { createAnthropic } from '@ai-sdk/anthropic'
import { APICallError, generateText, streamText, wrapLanguageModel } from 'ai'
import { assert, test } from '#test'
import { refusedChangedHistory, settingStaleReasoningAside, staleReasoningRetry } from './staleReasoning.ts'

const REFUSAL =
  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. ' +
  'Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block". ' +
  'The `system` prompt differs from the one this block was created with.'
const DAMAGED = 'messages.1.content.0: Invalid `signature` in `thinking` block.'
const TOO_LONG = 'prompt is too long: 1200000 tokens > 1000000 maximum'

const ADAPTIVE = { type: 'adaptive' }
const SET_ASIDE = { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }

const refuse = (message: string) =>
  Response.json({ type: 'error', error: { type: 'invalid_request_error', message } }, { status: 400 })

const reply = (model: string) =>
  Response.json({
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'Atlas is ready.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  })

function streamedReply(model: string): Response {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Atlas is ready.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * The installed Anthropic adapter over a scripted API, behind the middleware: each request's
 * thinking setting and whether it carried the beta header the setting needs.
 */
function scripted(answers: (request: { model: string; stream?: boolean }, n: number) => Response) {
  const sent: unknown[][] = []
  const provider = createAnthropic({
    apiKey: 'test-api-key',
    fetch: (async (_input, init) => {
      const request = JSON.parse(String(init?.body))
      const betas = (new Headers(init?.headers).get('anthropic-beta') ?? '').split(',').map((beta) => beta.trim())
      sent.push([request.thinking, betas.includes('thinking-binding-controls-2026-08-01')])
      return answers(request, sent.length)
    }) as typeof fetch,
  })
  const model = wrapLanguageModel({ model: provider('claude-opus-5-5'), middleware: staleReasoningRetry() })
  return { model, sent }
}

const ask = (model: ReturnType<typeof scripted>['model'], thinking: Record<string, unknown> = ADAPTIVE) =>
  generateText({
    model,
    maxRetries: 0,
    maxOutputTokens: 1024,
    providerOptions: { anthropic: { thinking } as never },
    prompt: 'Summarize this synthetic note: Atlas is ready.',
  })

test('a turn refused for changed history is answered with stale reasoning set aside', async () => {
  const { model, sent } = scripted((request, n) => (n === 1 ? refuse(REFUSAL) : reply(request.model)))
  const first = await ask(model)
  const second = await ask(model)
  assert({
    given: 'a reply whose reasoning the API refuses because an earlier part of the request changed',
    should: 'send the turn once more with the setting, and keep sending it for that model',
    actual: [first.text, second.text, sent],
    expected: [
      'Atlas is ready.',
      'Atlas is ready.',
      [
        [ADAPTIVE, false],
        [SET_ASIDE, true],
        [SET_ASIDE, true],
      ],
    ],
  })
})

test('a streamed turn refused for changed history is answered the same way', async () => {
  const { model, sent } = scripted((request, n) => (n === 1 ? refuse(REFUSAL) : streamedReply(request.model)))
  const result = streamText({
    model,
    maxRetries: 0,
    maxOutputTokens: 1024,
    providerOptions: { anthropic: { thinking: ADAPTIVE } as never },
    prompt: 'Summarize this synthetic note: Atlas is ready.',
  })
  assert({
    given: 'a streamed turn the API refuses before any output',
    should: 'stream the answer of the second request',
    actual: [await result.text, sent],
    expected: [
      'Atlas is ready.',
      [
        [ADAPTIVE, false],
        [SET_ASIDE, true],
      ],
    ],
  })
})

test('a request with no thinking option gains adaptive thinking with the setting', async () => {
  const { model, sent } = scripted((request, n) => (n === 1 ? refuse(REFUSAL) : reply(request.model)))
  await generateText({ model, maxRetries: 0, maxOutputTokens: 1024, prompt: 'Summarize: Atlas is ready.' })
  assert({
    given: 'a preset that leaves thinking to the model, refused for changed history',
    should: 'retry with the setting on the adaptive thinking the model already runs',
    actual: sent,
    expected: [
      [undefined, false],
      [SET_ASIDE, true],
    ],
  })
})

test('only the refusal for changed history is sent again', async () => {
  const outcomes: unknown[][] = []
  const cases: [string, string, Record<string, unknown>][] = [
    ['another 400', TOO_LONG, ADAPTIVE],
    ['a damaged signature', DAMAGED, ADAPTIVE],
    ['a preset that chose to fail', REFUSAL, { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'error' } }],
    ['thinking that is not adaptive', REFUSAL, { type: 'disabled' }],
  ]
  for (const [name, message, thinking] of cases) {
    const { model, sent } = scripted(() => refuse(message))
    const error = await ask(model, thinking).then(
      () => null,
      (thrown: unknown) => thrown,
    )
    outcomes.push([name, sent.length, APICallError.isInstance(error) && error.message === message])
  }
  assert({
    given: 'refusals the setting cannot help, and presets that cannot or chose not to take it',
    should: 'send each request once and surface the API error unchanged',
    actual: outcomes,
    expected: [
      ['another 400', 1, true],
      ['a damaged signature', 1, true],
      ['a preset that chose to fail', 1, true],
      ['thinking that is not adaptive', 1, true],
    ],
  })
})

test('refusedChangedHistory reads only the 400 that names another conversation', () => {
  const error = (statusCode: number, message: string) =>
    new APICallError({ url: 'https://example.com/messages', statusCode, message, requestBodyValues: {} })
  assert({
    given: 'API errors of several kinds',
    should: 'match the changed-history refusal alone',
    actual: [
      refusedChangedHistory(error(400, REFUSAL)),
      refusedChangedHistory(error(400, DAMAGED)),
      refusedChangedHistory(error(400, TOO_LONG)),
      refusedChangedHistory(error(529, REFUSAL)),
      refusedChangedHistory(new Error(REFUSAL)),
    ],
    expected: [true, false, false, false, false],
  })
})

test('settingStaleReasoningAside leaves a value it cannot change as given', () => {
  const chosen = { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'error' } }
  const disabled = { type: 'disabled' }
  assert({
    given: 'thinking that already chose a behavior, or is not adaptive',
    should: 'return the same value, so a caller can tell nothing was added',
    actual: [settingStaleReasoningAside(chosen) === chosen, settingStaleReasoningAside(disabled) === disabled],
    expected: [true, true],
  })
})
