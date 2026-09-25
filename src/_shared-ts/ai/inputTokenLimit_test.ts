import { assert, test } from '#test'
import { InputTokenLimitError, withAnthropicTokenCount, withContextWindow } from './inputTokenLimit.ts'

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
