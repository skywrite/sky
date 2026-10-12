import { assert, test } from '#test'
import { awaitReturn, frames, Silence } from './turnStream.ts'

function streaming(chunks: string[], close: boolean): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        if (close) controller.close()
      },
    }),
  )
}

test({ name: 'turnStream - frames come off the stream as they complete, split however the bytes arrive' }, async () => {
  const response = streaming(
    ['event: model-start\ndata: {"type":"model-start"}\n\nevent: text-de', 'lta\ndata: {"text":"Hi"}\n\n'],
    true,
  )
  const seen: Array<[string, unknown]> = []
  for await (const frame of frames(response, 1000)) seen.push([frame.event, frame.data])
  assert({
    given: 'two frames, the second split across chunks',
    should: 'yield both whole, then end with the stream',
    actual: seen,
    expected: [
      ['model-start', { type: 'model-start' }],
      ['text-delta', { text: 'Hi' }],
    ],
  })
})

test({ name: 'turnStream - a stream that falls silent ends as lost, not as finished' }, async () => {
  const response = streaming(['event: model-start\ndata: {"type":"model-start"}\n\n'], false)
  const seen: string[] = []
  let ended: unknown = null
  try {
    for await (const frame of frames(response, 30)) seen.push(frame.event)
  } catch (err) {
    ended = err
  }
  assert({
    given: 'one frame, then nothing, on a socket that stays open',
    should: 'yield the frame and then throw a Silence',
    actual: { seen, silence: ended instanceof Silence, message: (ended as Error)?.message },
    expected: { seen: ['model-start'], silence: true, message: 'nothing from the service for 0s' },
  })
})

test({ name: 'turnStream - the wait for the service runs the schedule and ends on the first answer' }, async () => {
  const slept: number[] = []
  const sleep = (ms: number) => {
    slept.push(ms)
    return Promise.resolve()
  }
  let calls = 0
  const flaky = () => {
    calls++
    if (calls <= 2) return Promise.reject(new TypeError('Failed to fetch'))
    if (calls === 3) return Promise.resolve(new Response('starting', { status: 503 }))
    return Promise.resolve(Response.json({ turns: [1, 2] }))
  }
  const back = await awaitReturn(flaky, [1, 2, 4, 8, 16], sleep)
  const gone = await awaitReturn(() => Promise.resolve(new Response('no', { status: 404 })), [1, 2], sleep)
  const away = await awaitReturn(() => Promise.reject(new TypeError('Failed to fetch')), [1, 2], sleep)
  assert({
    given: 'a service refusing twice and erroring once before answering, one without the thread, and one never back',
    should: 'answer on the fourth try, say gone at once, and give up after the schedule',
    actual: {
      back: back.kind === 'answered' ? await back.response.json() : back,
      gone,
      away,
      slept,
    },
    expected: {
      back: { turns: [1, 2] },
      gone: { kind: 'gone' },
      away: { kind: 'away' },
      slept: [1, 2, 4, 8, 1, 1, 2],
    },
  })
})
