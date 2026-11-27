import { once } from 'node:events'
import OpenAI from 'openai'
import { WebSocketServer } from 'ws'
import { assert, test } from '#test'
import { liveBackend } from './liveBackend.ts'

test('Live sideband holds large outputs until completion and sends one ordered continuation', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const events: Array<{ type: string; item?: { call_id: string; output: unknown } }> = []
  let attached = ''
  let finish!: () => void
  const received = new Promise<void>((resolve) => {
    finish = resolve
  })
  server.on('connection', (socket, request) => {
    attached = request.url ?? ''
    socket.on('message', (message) => {
      const event = JSON.parse(String(message)) as (typeof events)[number]
      events.push(event)
      if (event.type === 'response.create') finish()
    })
  })
  const backend = liveBackend(
    new OpenAI({ apiKey: 'synthetic-test-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
    'live_synthetic',
  )
  try {
    const evidence = 'Atlas evidence. '.repeat(6000)
    await backend.output('read', [{ type: 'input_text', text: evidence }])
    await backend.output('read', 'A lost acknowledgement must not replace the result.')
    await backend.output('write', '{"success":true}')
    assert({
      given: 'completed local tools before response.completed',
      should: 'retain results without sending them to an active backend response',
      actual: events,
      expected: [],
    })
    await Promise.all([backend.resume(['read', 'write']), backend.resume(['read', 'write'])])
    await received
    assert({
      given: 'large document content and a retried continuation',
      should: 'use the SDK sideband and preserve output order without repeating the continuation',
      actual: [attached, events.map((event) => event.type), events[0].item?.output, events[1].item?.call_id],
      expected: [
        '/v1/live/sessions/live_synthetic/attach',
        ['response.item.create', 'response.item.create', 'response.create'],
        [{ type: 'input_text', text: evidence }],
        'write',
      ],
    })
  } finally {
    backend.close()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a rejected note is skipped, and the continuation after it still goes out; other errors still end the connection', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const received: Array<{ type: string; event_id?: string; delegation_id?: string | null; content?: string }> = []
  let finish!: () => void
  const continued = new Promise<void>((resolve) => {
    finish = resolve
  })
  let rejectNext = true
  server.on('connection', (socket) => {
    socket.on('message', (message) => {
      const event = JSON.parse(String(message)) as (typeof received)[number]
      received.push(event)
      if (event.type === 'session.thinking.append' && rejectNext) {
        rejectNext = false
        socket.send(
          JSON.stringify({
            type: 'error',
            event_id: 'evt_1',
            error: {
              type: 'invalid_request_error',
              code: 'too_long',
              message: 'Too long',
              client_event_id: event.event_id,
            },
          }),
        )
      }
      if (event.type === 'response.create') finish()
    })
  })
  const backend = liveBackend(
    new OpenAI({ apiKey: 'synthetic-test-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
    'live_synthetic',
  )
  try {
    await backend.note!({ type: 'session.thinking.append', content: 'Update: Atlas moved to Friday.' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await backend.output('read', 'Atlas evidence')
    await backend.resume(['read'])
    await continued
    assert({
      given: 'a note the session rejects, then a tool continuation',
      should: 'mark the note as the service’s own, skip its rejection, and still send the continuation',
      actual: [
        received.map((event) => event.type),
        received[0]?.event_id?.startsWith('sky-note-'),
        received[0]?.delegation_id,
      ],
      expected: [['session.thinking.append', 'response.item.create', 'response.create'], true, null],
    })
    const conversation = [...server.clients][0]!
    conversation.send(
      JSON.stringify({
        type: 'error',
        event_id: 'evt_2',
        error: { type: 'server_error', code: 'boom', message: 'Boom' },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    let failed = ''
    await backend.note!({ type: 'session.thinking.append', content: 'Another update.' }).catch((error: Error) => {
      failed = error.message
    })
    assert({
      given: 'an error that is not about one of the service’s notes',
      should: 'end the connection for later sends, as before',
      actual: failed,
      expected: 'Boom',
    })
  } finally {
    backend.close()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a send waiting on a first attach that the server refuses tries once more on a fresh connection', async () => {
  let attempts = 0
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (_info, done) => {
      attempts++
      done(attempts > 1, 503)
    },
  })
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const received: string[] = []
  server.on('connection', (socket) => {
    socket.on('message', (message) => received.push((JSON.parse(String(message)) as { type: string }).type))
  })
  const backend = liveBackend(
    new OpenAI({ apiKey: 'synthetic-test-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
    'live_synthetic',
  )
  try {
    // Sent at once, so it waits on the attach the server refuses.
    await backend.note!({ type: 'session.thinking.append', content: 'Update: Atlas moved to Friday.' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert({
      given: 'a first attach the server refuses, with a note already waiting on it',
      should: 'connect again and deliver the note',
      actual: { attempts, received },
      expected: { attempts: 2, received: ['session.thinking.append'] },
    })
  } finally {
    backend.close()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
