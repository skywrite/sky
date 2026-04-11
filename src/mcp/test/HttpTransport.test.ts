/**
 * Tests for HTTP Transport
 */

import { assert, test } from '#test'
import { HttpTransport } from '../transports/HttpTransport.ts'

test('HttpTransport - initialization', () => {
  const transport = new HttpTransport({
    port: 8081,
    hostname: 'localhost',
  })

  assert({
    given: 'a new HTTP transport',
    should: 'not be connected initially',
    actual: transport.isConnected(),
    expected: false,
  })
})

test('HttpTransport - connect and health check', async () => {
  const transport = new HttpTransport({
    port: 8082,
    hostname: 'localhost',
  })

  await transport.connect()

  assert({
    given: 'a connected HTTP transport',
    should: 'be connected',
    actual: transport.isConnected(),
    expected: true,
  })

  // Test health endpoint
  const response = await fetch('http://localhost:8082/health')
  const data = await response.json()

  assert({
    given: 'a health check request',
    should: 'return ok status',
    actual: data.status,
    expected: 'ok',
  })

  await transport.close()
})

test('HttpTransport - authentication', async () => {
  const transport = new HttpTransport({
    port: 8083,
    hostname: 'localhost',
    authToken: 'test-token',
  })

  await transport.connect()

  // Test without auth
  const response1 = await fetch('http://localhost:8083/health')
  await response1.text() // Consume the body

  assert({
    given: 'a request without auth token',
    should: 'return 401',
    actual: response1.status,
    expected: 401,
  })

  // Test with auth
  const response2 = await fetch('http://localhost:8083/health', {
    headers: {
      Authorization: 'Bearer test-token',
    },
  })
  await response2.json() // Consume the body

  assert({
    given: 'a request with valid auth token',
    should: 'return 200',
    actual: response2.status,
    expected: 200,
  })

  await transport.close()
})

test('HttpTransport - CORS headers', async () => {
  const transport = new HttpTransport({
    port: 8084,
    hostname: 'localhost',
    cors: true,
  })

  await transport.connect()

  const response = await fetch('http://localhost:8084/health')
  await response.json() // Consume the body

  assert({
    given: 'a request with CORS enabled',
    should: 'include CORS headers',
    actual: response.headers.get('Access-Control-Allow-Origin'),
    expected: '*',
  })

  await transport.close()
})

test('HttpTransport - RPC endpoint', async () => {
  const transport = new HttpTransport({
    port: 8085,
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
        result: { echo: 'test' },
      }),
    )
  })

  await transport.connect()

  // Send RPC request
  const response = await fetch('http://localhost:8085/rpc', {
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
    should: 'return the response',
    actual: data.result.echo,
    expected: 'test',
  })

  await transport.close()
})

test('HttpTransport - bearer token on RPC endpoint', async () => {
  const transport = new HttpTransport({
    port: 8086,
    hostname: 'localhost',
    authToken: 'secret-api-key-12345',
  })

  // Set up message handler
  transport.onMessage(async (message) => {
    await transport.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { authenticated: true },
      }),
    )
  })

  await transport.connect()

  // Test RPC request without bearer token
  const response1 = await fetch('http://localhost:8086/rpc', {
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

  await response1.text() // Consume the body

  assert({
    given: 'an RPC request without bearer token',
    should: 'return 401 Unauthorized',
    actual: response1.status,
    expected: 401,
  })

  // Test RPC request with incorrect bearer token
  const response2 = await fetch('http://localhost:8086/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer wrong-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: {},
    }),
  })

  await response2.text() // Consume the body

  assert({
    given: 'an RPC request with incorrect bearer token',
    should: 'return 401 Unauthorized',
    actual: response2.status,
    expected: 401,
  })

  // Test RPC request with correct bearer token
  const response3 = await fetch('http://localhost:8086/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-api-key-12345',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: {},
    }),
  })

  const data = await response3.json()

  assert({
    given: 'an RPC request with correct bearer token',
    should: 'return 200 OK',
    actual: response3.status,
    expected: 200,
  })

  assert({
    given: 'an RPC request with correct bearer token',
    should: 'return authenticated response',
    actual: data.result.authenticated,
    expected: true,
  })

  await transport.close()
})

test('HttpTransport - bearer token format validation', async () => {
  const transport = new HttpTransport({
    port: 8087,
    hostname: 'localhost',
    authToken: 'my-token',
  })

  await transport.connect()

  // Test with malformed authorization header (no Bearer prefix)
  const response1 = await fetch('http://localhost:8087/health', {
    headers: {
      Authorization: 'my-token',
    },
  })

  await response1.text()

  assert({
    given: 'authorization header without Bearer prefix',
    should: 'return 401',
    actual: response1.status,
    expected: 401,
  })

  // Test with Bearer prefix but wrong token
  const response2 = await fetch('http://localhost:8087/health', {
    headers: {
      Authorization: 'Bearer wrong-token',
    },
  })

  await response2.text()

  assert({
    given: 'Bearer prefix with wrong token',
    should: 'return 401',
    actual: response2.status,
    expected: 401,
  })

  // Test with correct format and token
  const response3 = await fetch('http://localhost:8087/health', {
    headers: {
      Authorization: 'Bearer my-token',
    },
  })

  const data = await response3.json()

  assert({
    given: 'correct Bearer token format',
    should: 'return 200',
    actual: response3.status,
    expected: 200,
  })

  assert({
    given: 'correct Bearer token format',
    should: 'return ok status',
    actual: data.status,
    expected: 'ok',
  })

  await transport.close()
})
