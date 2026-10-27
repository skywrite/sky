import * as http from 'node:http'
import * as net from 'node:net'
import { WebSocket } from 'ws'
import { assert, test } from '#test'
import { NotebookChanges } from '../notebookChanges.ts'
import { Store } from '../store.ts'
import { createWebSocketHandler } from './websocket.ts'

/** Sends a WebSocket handshake by hand and returns the status line the service answers with. */
function handshake(port: number, headers: Record<string, string>, route = '/graphql'): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = Object.entries({
        Host: `127.0.0.1:${port}`,
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Protocol': 'graphql-transport-ws',
        ...headers,
      }).map(([name, value]) => `${name}: ${value}`)
      socket.write(`GET ${route} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    })
    socket.once('data', (data) => {
      resolve(data.toString().split('\r\n')[0] ?? '')
      socket.destroy()
    })
    socket.once('error', reject)
  })
}

test('the GraphQL WebSocket upgrades programs on this Mac and refuses other sites at the handshake', async () => {
  const server = http.createServer()
  server.on('upgrade', createWebSocketHandler(new Store()).handleUpgrade)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as net.AddressInfo
    const actual = [
      await handshake(port, {}),
      await handshake(port, {
        Origin: 'https://example.com',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'websocket',
      }),
      await handshake(port, { Host: `example.com:${port}` }),
    ]
    assert({
      given: 'a program, a page on another site, and a handshake addressed to another name',
      should: 'upgrade only the program',
      actual,
      expected: ['HTTP/1.1 101 Switching Protocols', 'HTTP/1.1 403 Forbidden', 'HTTP/1.1 403 Forbidden'],
    })
  } finally {
    server.close()
  }
})

test('notebook subscriptions broadcast changes, acknowledge heartbeats and reject other sites', async () => {
  const changes = new NotebookChanges('/notebook', '/notebook/time', 5)
  const handler = createWebSocketHandler(new Store(), changes)
  const server = http.createServer()
  server.on('upgrade', handler.handleUpgrade)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  const clients: WebSocket[] = []
  const next = (client: WebSocket) =>
    new Promise<string>((resolve) => client.once('message', (data) => resolve(data.toString())))
  try {
    for (let i = 0; i < 2; i++) {
      const client = new WebSocket(`ws://127.0.0.1:${port}/notebook/changes`)
      clients.push(client)
      assert({
        given: 'a new tab',
        should: 'request a fresh read after subscribing',
        actual: JSON.parse(await next(client)).type,
        expected: 'ready',
      })
    }
    const messages = clients.map(next)
    changes.changed('/notebook/me/about.md')
    const expected = { type: 'changed', paths: ['me/about.md'], days: null }
    assert({
      given: 'a watched shared file changes',
      should: 'notify both tabs',
      actual: (await Promise.all(messages)).map((message) => JSON.parse(message)),
      expected: [expected, expected],
    })
    const pong = next(clients[0])
    clients[0].send('ping')
    assert({
      given: 'a browser heartbeat',
      should: 'confirm the connection is alive',
      actual: await pong,
      expected: 'pong',
    })
    assert({
      given: 'a notebook subscription from another site',
      should: 'deny the handshake',
      actual: await handshake(
        port,
        { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' },
        '/notebook/changes',
      ),
      expected: 'HTTP/1.1 403 Forbidden',
    })
  } finally {
    for (const client of clients) client.terminate()
    handler.close()
    changes.close()
    server.close()
  }
})
