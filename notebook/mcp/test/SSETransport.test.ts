/**
 * Tests for SSE (Server-Sent Events) Transport
 */

import { assert, test } from '#test'
import { SSETransport } from '../transports/SSETransport.ts'

test('SSETransport - initialization', () => {
  const transport = new SSETransport({
    port: 9001,
    hostname: 'localhost',
  })

  assert({
    given: 'a new SSE transport',
    should: 'not be connected initially',
    actual: transport.isConnected(),
    expected: false,
  })
})

test('SSETransport - connect and root endpoint', async () => {
  const transport = new SSETransport({
    port: 9002,
    hostname: 'localhost',
  })

  await transport.connect()

  assert({
    given: 'a connected SSE transport',
    should: 'be connected',
    actual: transport.isConnected(),
    expected: true,
  })

  // Test root endpoint
  const response = await fetch('http://localhost:9002/')
  const text = await response.text()

  assert({
    given: 'a request to root endpoint',
    should: 'return server running message',
    actual: text,
    expected: 'MCP SSE Server Running',
  })

  await transport.close()
})

test('SSETransport - SSE endpoint with GET', async () => {
  const transport = new SSETransport({
    port: 9003,
    hostname: 'localhost',
  })

  await transport.connect()

  // Test SSE endpoint with GET
  const response = await fetch('http://localhost:9003/sse')

  assert({
    given: 'a GET request to /sse',
    should: 'return event-stream content type',
    actual: response.headers.get('Content-Type'),
    expected: 'text/event-stream',
  })

  assert({
    given: 'a GET request to /sse',
    should: 'have no-cache header',
    actual: response.headers.get('Cache-Control'),
    expected: 'no-cache',
  })

  assert({
    given: 'a GET request to /sse',
    should: 'have keep-alive connection',
    actual: response.headers.get('Connection'),
    expected: 'keep-alive',
  })

  // Close transport first to clean up connections, then cancel response
  await transport.close()

  // Give it a moment to clean up
  await new Promise((resolve) => setTimeout(resolve, 10))

  try {
    await response.body?.cancel()
  } catch {
    // Ignore errors from canceling already-closed stream
  }
})

test('SSETransport - RPC endpoint', async () => {
  const transport = new SSETransport({
    port: 9004,
    hostname: 'localhost',
  })

  // Set up message handler
  let receivedMessage = ''
  transport.onMessage(async (message) => {
    receivedMessage = message
    // Send a response
    await transport.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { status: 'ok' },
      }),
    )
  })

  await transport.connect()

  // Send RPC request
  const response = await fetch('http://localhost:9004/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: {},
    }),
  })

  const data = await response.json()

  assert({
    given: 'an RPC request',
    should: 'receive the message',
    actual: JSON.parse(receivedMessage).method,
    expected: 'test',
  })

  assert({
    given: 'an RPC request',
    should: 'return 200 status',
    actual: response.status,
    expected: 200,
  })

  assert({
    given: 'an RPC request',
    should: 'have JSON content type',
    actual: response.headers.get('Content-Type'),
    expected: 'application/json',
  })

  await transport.close()
})

test('SSETransport - RPC endpoint with CORS', async () => {
  const transport = new SSETransport({
    port: 9005,
    hostname: 'localhost',
  })

  transport.onMessage(async (message) => {
    await transport.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      }),
    )
  })

  await transport.connect()

  const response = await fetch('http://localhost:9005/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
    }),
  })

  await response.json()

  assert({
    given: 'an RPC request',
    should: 'include CORS headers',
    actual: response.headers.get('Access-Control-Allow-Origin'),
    expected: '*',
  })

  await transport.close()
})

test('SSETransport - 404 for unknown paths', async () => {
  const transport = new SSETransport({
    port: 9006,
    hostname: 'localhost',
  })

  await transport.connect()

  const response = await fetch('http://localhost:9006/unknown')
  await response.text()

  assert({
    given: 'a request to unknown path',
    should: 'return 404',
    actual: response.status,
    expected: 404,
  })

  await transport.close()
})

test('SSETransport - RPC endpoint with invalid method', async () => {
  const transport = new SSETransport({
    port: 9007,
    hostname: 'localhost',
  })

  await transport.connect()

  const response = await fetch('http://localhost:9007/rpc', {
    method: 'GET',
  })

  await response.text()

  assert({
    given: 'a GET request to RPC endpoint',
    should: 'return 405 method not allowed',
    actual: response.status,
    expected: 405,
  })

  await transport.close()
})

test('SSETransport - multiple connections', async () => {
  const transport = new SSETransport({
    port: 9008,
    hostname: 'localhost',
  })

  await transport.connect()

  // Create multiple SSE connections
  const response1 = fetch('http://localhost:9008/sse')
  const response2 = fetch('http://localhost:9008/sse')

  const [r1, r2] = await Promise.all([response1, response2])

  assert({
    given: 'multiple SSE connections',
    should: 'accept both connections',
    actual: r1.status === 200 && r2.status === 200,
    expected: true,
  })

  // Close transport first, then clean up response bodies
  await transport.close()

  // Give it a moment to clean up
  await new Promise((resolve) => setTimeout(resolve, 10))

  try {
    await r1.body?.cancel()
  } catch {
    // Ignore errors from canceling already-closed stream
  }

  try {
    await r2.body?.cancel()
  } catch {
    // Ignore errors from canceling already-closed stream
  }
})

test('SSETransport - close cleans up connections', async () => {
  const transport = new SSETransport({
    port: 9009,
    hostname: 'localhost',
  })

  await transport.connect()

  assert({
    given: 'a connected transport',
    should: 'be connected',
    actual: transport.isConnected(),
    expected: true,
  })

  await transport.close()

  assert({
    given: 'a closed transport',
    should: 'not be connected',
    actual: transport.isConnected(),
    expected: false,
  })

  // Verify server is actually closed by trying to connect
  let connectionFailed = false
  try {
    const response = await fetch('http://localhost:9009/', {
      signal: AbortSignal.timeout(1000),
    })
    await response.text()
  } catch {
    connectionFailed = true
  }

  assert({
    given: 'a closed transport',
    should: 'reject new connections',
    actual: connectionFailed,
    expected: true,
  })
})

test('SSETransport - bearer token authentication', async () => {
  const transport = new SSETransport({
    port: 9010,
    hostname: 'localhost',
    authToken: 'sse-secret-token',
  })

  await transport.connect()

  // Test root endpoint without auth
  const response1 = await fetch('http://localhost:9010/')
  await response1.text()

  assert({
    given: 'a request without bearer token',
    should: 'return 401',
    actual: response1.status,
    expected: 401,
  })

  // Test root endpoint with wrong token
  const response2 = await fetch('http://localhost:9010/', {
    headers: {
      Authorization: 'Bearer wrong-token',
    },
  })
  await response2.text()

  assert({
    given: 'a request with wrong bearer token',
    should: 'return 401',
    actual: response2.status,
    expected: 401,
  })

  // Test root endpoint with correct token
  const response3 = await fetch('http://localhost:9010/', {
    headers: {
      Authorization: 'Bearer sse-secret-token',
    },
  })
  const text = await response3.text()

  assert({
    given: 'a request with correct bearer token',
    should: 'return 200',
    actual: response3.status,
    expected: 200,
  })

  assert({
    given: 'a request with correct bearer token',
    should: 'return server running message',
    actual: text,
    expected: 'MCP SSE Server Running',
  })

  await transport.close()
})

test('SSETransport - bearer token on RPC endpoint (auth check only)', async () => {
  const transport = new SSETransport({
    port: 9011,
    hostname: 'localhost',
    authToken: 'rpc-bearer-key',
  })

  await transport.connect()

  // Test RPC without auth - should be rejected before handler is called
  const response1 = await fetch('http://localhost:9011/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
    }),
  })

  await response1.text()

  assert({
    given: 'an RPC request without bearer token',
    should: 'return 401',
    actual: response1.status,
    expected: 401,
  })

  // Test RPC with wrong token - should also be rejected
  const response2 = await fetch('http://localhost:9011/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer wrong-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
    }),
  })

  await response2.text()

  assert({
    given: 'an RPC request with wrong bearer token',
    should: 'return 401',
    actual: response2.status,
    expected: 401,
  })

  await transport.close()
})

test('SSETransport - bearer token on SSE endpoint', async () => {
  const transport = new SSETransport({
    port: 9012,
    hostname: 'localhost',
    authToken: 'sse-stream-token',
  })

  await transport.connect()

  // Test SSE endpoint without auth
  const response1 = await fetch('http://localhost:9012/sse')

  assert({
    given: 'an SSE request without bearer token',
    should: 'return 401',
    actual: response1.status,
    expected: 401,
  })

  await response1.text()

  // Test SSE endpoint with correct auth
  const response2 = await fetch('http://localhost:9012/sse', {
    headers: {
      Authorization: 'Bearer sse-stream-token',
    },
  })

  assert({
    given: 'an SSE request with correct bearer token',
    should: 'return 200',
    actual: response2.status,
    expected: 200,
  })

  assert({
    given: 'an SSE request with correct bearer token',
    should: 'return event-stream content type',
    actual: response2.headers.get('Content-Type'),
    expected: 'text/event-stream',
  })

  // Clean up
  await transport.close()

  // Give it a moment to clean up
  await new Promise((resolve) => setTimeout(resolve, 10))

  try {
    await response2.body?.cancel()
  } catch {
    // Ignore errors from canceling already-closed stream
  }
})
