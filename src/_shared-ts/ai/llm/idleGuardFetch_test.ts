import { assert, test } from '#test'
import type { IdleEvent } from './idleGuardFetch.ts'
import { withStreamIdleGuard } from './idleGuardFetch.ts'

const STREAMING_BODY = JSON.stringify({ model: 'claude-opus-5', stream: true })
const PLAIN_BODY = JSON.stringify({ model: 'claude-opus-5' })

function textChunks(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

/** A fetch that never responds, but rejects on abort the way real fetch does. */
function hangingFetch(calls: number[]): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(calls.length + 1)
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('This operation was aborted', 'AbortError')),
        { once: true },
      )
    })
  }) as typeof fetch
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text
    text += decoder.decode(value)
  }
}

test('withStreamIdleGuard - passes non-streaming requests through untouched', async () => {
  const calls: RequestInit[] = []
  const original = new Response('ok')
  const base = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {})
    return Promise.resolve(original)
  }) as typeof fetch
  const guarded = withStreamIdleGuard(base, { idleMs: 10 })

  const outer = new AbortController()
  const response = await guarded('https://api.example.test', { body: PLAIN_BODY, signal: outer.signal })

  assert({
    given: 'a request without "stream":true in its body',
    should: 'reach the base fetch once, unwrapped, with the original signal',
    expected: { count: 1, sameResponse: true, sameSignal: true },
    actual: { count: calls.length, sameResponse: response === original, sameSignal: calls[0]?.signal === outer.signal },
  })
})

test('withStreamIdleGuard - streams a healthy response through', async () => {
  let count = 0
  const base = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    count++
    return Promise.resolve(new Response(textChunks('event: a\n', 'event: b\n'), { status: 200, statusText: 'OK' }))
  }) as typeof fetch
  const guarded = withStreamIdleGuard(base, { idleMs: 200 })

  const response = await guarded('https://api.example.test', { body: STREAMING_BODY })
  const text = response.body ? await readAll(response.body) : ''

  assert({
    given: 'a streaming response that keeps delivering bytes',
    should: 'pass every chunk and the status through on the first attempt',
    expected: { count: 1, status: 200, text: 'event: a\nevent: b\n' },
    actual: { count, status: response.status, text },
  })
})

test('withStreamIdleGuard - retries an unanswered request in place', async () => {
  const calls: number[] = []
  const events: IdleEvent[] = []
  const hang = hangingFetch(calls)
  const base = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (calls.length === 0) return hang(input, init)
    calls.push(calls.length + 1)
    return Promise.resolve(new Response(textChunks('late but fine'), { status: 200 }))
  }) as typeof fetch
  const guarded = withStreamIdleGuard(base, { idleMs: 20, onIdle: (event) => events.push(event) })

  const response = await guarded('https://api.example.test', { body: STREAMING_BODY })
  const text = response.body ? await readAll(response.body) : ''

  assert({
    given: 'a first attempt that never responds',
    should: 'abort it after idleMs and succeed on a fresh attempt',
    expected: {
      count: 2,
      text: 'late but fine',
      events: [{ phase: 'response', attempt: 1, retrying: true, idleMs: 20 }],
    },
    actual: { count: calls.length, text, events },
  })
})

test('withStreamIdleGuard - gives up after the attempt budget', async () => {
  const calls: number[] = []
  const events: IdleEvent[] = []
  const guarded = withStreamIdleGuard(hangingFetch(calls), {
    idleMs: 15,
    attempts: 2,
    onIdle: (event) => events.push(event),
  })

  let message = ''
  try {
    await guarded('https://api.example.test', { body: STREAMING_BODY })
  } catch (err) {
    message = (err as Error).message
  }

  assert({
    given: 'a request that never responds on any attempt',
    should: 'try the whole budget, then fail naming what happened',
    expected: { count: 2, retryFlags: [true, false], gaveUp: true },
    actual: {
      count: calls.length,
      retryFlags: events.map((event) => event.retrying),
      gaveUp: message.includes('after 2 attempt(s)'),
    },
  })
})

test('withStreamIdleGuard - errors the stream when the body goes idle mid-response', async () => {
  const events: IdleEvent[] = []
  const encoder = new TextEncoder()
  const base = ((_input: RequestInfo | URL, init?: RequestInit) => {
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode('first chunk'))
          return
        }
        // Then silence: reject only when the guard aborts the request.
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('This operation was aborted', 'AbortError')),
            { once: true },
          )
        })
      },
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  }) as typeof fetch
  const guarded = withStreamIdleGuard(base, { idleMs: 20, onIdle: (event) => events.push(event) })

  const response = await guarded('https://api.example.test', { body: STREAMING_BODY })
  const reader = response.body!.getReader()
  const first = await reader.read()
  let message = ''
  try {
    await reader.read()
  } catch (err) {
    message = (err as Error).message
  }

  assert({
    given: 'a response body that delivers one chunk and then goes silent',
    should: 'deliver the chunk, then error the stream instead of retrying',
    expected: {
      first: 'first chunk',
      silent: true,
      events: [{ phase: 'body', attempt: 1, retrying: false, idleMs: 20 }],
    },
    actual: { first: new TextDecoder().decode(first.value), silent: message.includes('went silent'), events },
  })
})

test('withStreamIdleGuard - a caller abort wins over the idle retry', async () => {
  const calls: number[] = []
  const events: IdleEvent[] = []
  const guarded = withStreamIdleGuard(hangingFetch(calls), { idleMs: 50, onIdle: (event) => events.push(event) })

  const outer = new AbortController()
  setTimeout(() => outer.abort(), 5)
  let aborted = false
  try {
    await guarded('https://api.example.test', { body: STREAMING_BODY, signal: outer.signal })
  } catch (err) {
    aborted = (err as Error).name === 'AbortError'
  }

  assert({
    given: 'the caller aborting while the first attempt is pending',
    should: 'reject as an abort without retrying or reporting idleness',
    expected: { aborted: true, count: 1, events: 0 },
    actual: { aborted, count: calls.length, events: events.length },
  })
})
