import * as http from 'node:http'
import * as net from 'node:net'
import { assert, test } from '#test'
import { Store } from '../store.ts'
import { createWebSocketHandler } from './websocket.ts'

/** Sends a WebSocket handshake by hand and returns the status line the service answers with. */
function handshake(port: number, headers: Record<string, string>): Promise<string> {
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
      socket.write(`GET /graphql HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
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
