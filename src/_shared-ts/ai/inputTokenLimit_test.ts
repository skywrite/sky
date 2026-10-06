import { assert, test } from '#test'
import {
  ANTHROPIC_REQUEST_BYTES,
  InputTokenLimitError,
  RequestBodyLimitError,
  withAnthropicTokenCount,
  withContextWindow,
  withOpenAITokenCount,
} from './inputTokenLimit.ts'

const RESPONSES_URL = 'https://api.openai.com/v1/responses'
const RESPONSES_BODY = {
  model: 'test-model',
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Make the center green.' },
        { type: 'input_image', image_url: 'data:image/png;base64,YWFh', detail: 'auto' },
      ],
    },
  ],
  tools: [{ type: 'function', name: 'edit_image', parameters: { type: 'object' } }],
  reasoning: { effort: 'high' },
  text: { format: { type: 'text' } },
  store: false,
  stream: true,
  max_output_tokens: 200,
}

test('OpenAI counts native inputs and tool schemas with the actual output allowance', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = []
  const fetcher = withOpenAITokenCount((async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init!.body as string),
      auth: new Headers(init?.headers).get('Authorization'),
    })
    return Response.json({ input_tokens: 810 })
  }) as typeof fetch)
  let failure: unknown
  try {
    await withContextWindow(1000, () =>
      fetcher(RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: JSON.stringify(RESPONSES_BODY),
      }),
    )
  } catch (error) {
    failure = error
  }
  assert({
    given: 'native image input and tools that fit alone but leave too little room for output',
    should: 'count the original native content before generation, using the same authentication',
    actual: {
      calls,
      failure: failure instanceof InputTokenLimitError ? [failure.tokens, failure.limit] : null,
    },
    expected: {
      calls: [
        {
          url: `${RESPONSES_URL}/input_tokens`,
          body: {
            model: RESPONSES_BODY.model,
            input: RESPONSES_BODY.input,
            tools: RESPONSES_BODY.tools,
            reasoning: RESPONSES_BODY.reasoning,
            text: RESPONSES_BODY.text,
          },
          auth: 'Bearer test-key',
        },
      ],
      failure: [810, 790],
    },
  })
})

test('OpenAI counting is scoped to each chat and bypasses unrelated endpoints', async () => {
  const requests: string[] = []
  const bodies: string[] = []
  const fetcher = withOpenAITokenCount((async (url, init) => {
    requests.push(String(url))
    if (String(url).endsWith('/input_tokens')) return Response.json({ input_tokens: 810 })
    bodies.push(init!.body as string)
    return new Response('ok')
  }) as typeof fetch)
  const body = JSON.stringify(RESPONSES_BODY)
  const send = () => fetcher(RESPONSES_URL, { method: 'POST', body })
  const outcomes = await Promise.allSettled([
    withContextWindow(1000, send),
    withContextWindow(2000, send),
    send(),
    withContextWindow(1000, () => fetcher('https://example.com/chat/completions', { method: 'POST', body })),
  ])
  assert({
    given: 'concurrent chat windows, an unguarded caller and a compatible chat endpoint',
    should: 'reject only the small chat and pass each original generation body untouched',
    actual: [
      outcomes.map((outcome) => outcome.status),
      requests.filter((url) => url.endsWith('/input_tokens')).length,
      bodies,
    ],
    expected: [['rejected', 'fulfilled', 'fulfilled', 'fulfilled'], 2, [body, body, body]],
  })
})

test('OpenAI counter failures do not reject valid generation or swallow cancellation', async () => {
  let generations = 0
  const controller = new AbortController()
  const fetcher = withOpenAITokenCount((async (url) => {
    if (String(url).endsWith('/input_tokens')) return new Response('Unavailable', { status: 503 })
    generations++
    return new Response('ok')
  }) as typeof fetch)
  const init = { method: 'POST', body: JSON.stringify(RESPONSES_BODY) }
  await withContextWindow(1000, () => fetcher(RESPONSES_URL, init))
  controller.abort(new Error('Stopped'))
  let stopped = false
  try {
    await withContextWindow(1000, () => fetcher(RESPONSES_URL, { ...init, signal: controller.signal }))
  } catch (error) {
    stopped = (error as Error).message === 'Stopped'
  }
  assert({
    given: 'an unavailable counting endpoint followed by a cancelled request',
    should: 'let generation enforce context capacity but never run a cancelled request',
    actual: [generations, stopped],
    expected: [1, true],
  })
})

const URL = 'https://api.anthropic.com/v1/messages'
const BODY = {
  model: 'test-model',
  system: [{ type: 'text', text: 'Standing instructions' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize the sources.' }] }],
  tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
  thinking: { type: 'adaptive' },
  stream: true,
  max_tokens: 200,
}

test('oversized UTF-8 bodies are refused before counting or generation, with or without a token window', async () => {
  let networkCalls = 0
  const fetcher = withAnthropicTokenCount((async (_url) => {
    networkCalls++
    return Response.json({ input_tokens: 1 })
  }) as typeof fetch)
  // Character count fits, but the actual UTF-8 bytes exceed the transport cap.
  const body = JSON.stringify({ ...BODY, system: '界'.repeat(Math.ceil(ANTHROPIC_REQUEST_BYTES / 3)) })
  const send = () => fetcher(URL, { method: 'POST', body })
  const outcomes = await Promise.allSettled([send(), withContextWindow(1_000_000, send)])
  assert({
    given: 'a payload that exceeds bytes even though it is below the character and token allowances',
    should: 'catch the entire serialized size locally for every caller without exposing the payload in errors',
    actual: {
      characterCountFits: body.length < ANTHROPIC_REQUEST_BYTES,
      networkCalls,
      failures: outcomes.map((outcome) =>
        outcome.status === 'rejected' && outcome.reason instanceof RequestBodyLimitError
          ? [outcome.reason.bytes > outcome.reason.limit, outcome.reason.message.includes('界')]
          : null,
      ),
    },
    expected: {
      characterCountFits: true,
      networkCalls: 0,
      failures: [
        [true, false],
        [true, false],
      ],
    },
  })
})

test('Claude counts the serialized request and reserves its actual output allowance', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetcher = withAnthropicTokenCount((async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init!.body as string) })
    return Response.json({ input_tokens: 810 })
  }) as typeof fetch)
  let failure: unknown
  try {
    await withContextWindow(1000, () => fetcher(URL, { method: 'POST', body: JSON.stringify(BODY) }))
  } catch (error) {
    failure = error
  }
  assert({
    given: 'a request whose input fits alone but leaves too little room for output',
    should: 'count systems, messages and tools, omit generation options, and never start generation',
    actual: {
      urls: calls.map((call) => call.url),
      body: calls[0].body,
      failure: failure instanceof InputTokenLimitError ? [failure.tokens, failure.limit] : null,
    },
    expected: {
      urls: [`${URL}/count_tokens`],
      body: {
        model: BODY.model,
        messages: BODY.messages,
        system: BODY.system,
        tools: BODY.tools,
        thinking: BODY.thinking,
      },
      failure: [810, 790],
    },
  })
})

test('token counting is isolated between concurrent chats and leaves other callers alone', async () => {
  let generations = 0
  let counts = 0
  const fetcher = withAnthropicTokenCount((async (url) => {
    if (String(url).endsWith('/count_tokens')) {
      counts++
      await Promise.resolve()
      return Response.json({ input_tokens: 810 })
    }
    generations++
    return new Response('ok')
  }) as typeof fetch)
  const send = () => fetcher(URL, { method: 'POST', body: JSON.stringify(BODY) })
  const results = await Promise.allSettled([withContextWindow(1000, send), withContextWindow(2000, send), send()])
  assert({
    given: 'a small-window chat, a larger-window chat and a caller without a guard',
    should: 'refuse only the small request and count only the two chats',
    actual: { results: results.map((r) => r.status), counts, generations },
    expected: { results: ['rejected', 'fulfilled', 'fulfilled'], counts: 2, generations: 2 },
  })
})

test('an unavailable token counter falls back to the ordinary request, but cancellation does not', async () => {
  let generations = 0
  const controller = new AbortController()
  const fetcher = withAnthropicTokenCount((async (url, init) => {
    if (String(url).endsWith('/count_tokens')) {
      if (init?.signal && controller.signal.aborted) throw controller.signal.reason
      return new Response('Unavailable', { status: 429 })
    }
    generations++
    return new Response('ok')
  }) as typeof fetch)
  const init = { method: 'POST', body: JSON.stringify(BODY) }
  await withContextWindow(1000, () => fetcher(URL, init))
  controller.abort(new Error('Stopped'))
  let stopped = false
  try {
    await withContextWindow(1000, () => fetcher(URL, { ...init, signal: controller.signal }))
  } catch {
    stopped = true
  }
  assert({
    given: 'a rate-limited counter, then a cancelled count',
    should: 'continue the first request and stop the second before generation',
    actual: { generations, stopped },
    expected: { generations: 1, stopped: true },
  })
})
