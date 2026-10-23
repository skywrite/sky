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
