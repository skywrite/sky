import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import { McpClient, McpError } from './client.ts'

// A stand-in server: the same framing as the real one, a handful of
// scripted answers. It speaks stdio like `playwright mcp` does, so the
// client under test is the one that talks to the browser.
const FAKE_SERVER = `
import * as readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
process.stderr.write('fake server up\\n')
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.method === 'initialize')
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Fake', version: '0.1' } } })
  if (msg.method === 'notifications/initialized') return
  if (msg.method === 'notifications/cancelled') { process.stderr.write('cancelled ' + msg.params.requestId + '\\n'); return }
  if (msg.method === 'tools/list')
    return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
  if (msg.method === 'tools/call') {
    const { text, fail, picture, hang } = msg.params.arguments
    if (hang) return
    if (msg.params.name !== 'echo') return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool: ' + msg.params.name } })
    const content = [{ type: 'text', text: 'echo: ' + text }]
    if (picture) content.push({ type: 'image', data: 'aGk=', mimeType: 'image/png' })
    return send({ jsonrpc: '2.0', id: msg.id, result: { content, isError: !!fail } })
  }
})
rl.on('close', () => process.exit(0))
`

async function fakeServer(): Promise<{ client: McpClient; stderr: string[]; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mcp-client-test-'))
  const script = path.join(root, 'server.ts')
  await writeFile(script, FAKE_SERVER)
  const stderr: string[] = []
  const client = await McpClient.start({
    command: process.execPath,
    args: [script],
    clientName: 'sky-test',
    onStderr: (line) => stderr.push(line),
  })
  return { client, stderr, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('stdio cancellation reaches the credential-owning worker', async () => {
  const { client, stderr, cleanup } = await fakeServer()
  try {
    const abort = new AbortController()
    const request = client.callTool('echo', { hang: true }, { signal: abort.signal }).catch(() => null)
    abort.abort()
    await request
    await client.listTools()
    // stderr is a separate pipe: close drains the child before inspecting it.
    await client.close()
    assert({
      given: 'a revoked task while its worker is waiting',
      should: 'send cancellation for the pending request',
      actual: stderr.some((line) => line.startsWith('cancelled ')),
      expected: true,
    })
  } finally {
    await client.close()
    await cleanup()
  }
})

test('the client completes the handshake, lists tools, and calls one', async () => {
  const { client, stderr, cleanup } = await fakeServer()
  try {
    assert({
      given: 'a server that answers initialize',
      should: 'record what it calls itself',
      actual: client.serverInfo,
      expected: { name: 'Fake', version: '0.1' },
    })
    const tools = await client.listTools()
    assert({
      given: 'tools/list',
      should: 'return the server tools with their schemas',
      actual: tools.map((t) => [t.name, t.inputSchema.type]),
      expected: [['echo', 'object']],
    })
    const result = await client.callTool('echo', { text: 'hello — café', picture: true })
    assert({
      given: 'a tool result with text and an image',
      should: 'pass both parts through with isError false, and the text intact past ASCII',
      actual: {
        isError: result.isError,
        types: result.content.map((c) => c.type),
        text: (result.content[0] as { text: string }).text,
      },
      expected: { isError: false, types: ['text', 'image'], text: 'echo: hello — café' },
    })
    const failed = await client.callTool('echo', { text: 'x', fail: true })
    assert({
      given: 'a tool that ran and failed',
      should: 'report isError rather than throw',
      actual: failed.isError,
      expected: true,
    })
    assert({
      given: 'the server wrote to stderr',
      should: 'hand each line to onStderr, never the terminal',
      actual: stderr,
      expected: ['fake server up'],
    })
  } finally {
    await client.close()
    await cleanup()
  }
})

test('protocol errors and silence surface as McpError', async () => {
  const { client, cleanup } = await fakeServer()
  try {
    const unknown = await client.callTool('nope', {}).then(
      () => 'resolved',
      (error: unknown) => (error instanceof McpError ? `McpError ${error.code}` : 'other'),
    )
    assert({
      given: 'a JSON-RPC error response',
      should: 'reject with an McpError carrying the code',
      actual: unknown,
      expected: 'McpError -32602',
    })
    const silent = await client.callTool('echo', { hang: true }, { timeoutMs: 100 }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof McpError ? error.message : 'other'),
    )
    assert({
      given: 'a call the server never answers',
      should: 'time out with a plain message',
      actual: silent,
      expected: 'tools/call did not answer within 0s',
    })
  } finally {
    await client.close()
    await cleanup()
  }
})

test('close ends the server and later calls fail fast', async () => {
  const { client, cleanup } = await fakeServer()
  try {
    await client.close()
    const after = await client.callTool('echo', { text: 'late' }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof McpError ? error.message : 'other'),
    )
    assert({
      given: 'a closed client',
      should: 'refuse new calls rather than hang',
      actual: after,
      expected: 'The browser server has stopped',
    })
  } finally {
    await cleanup()
  }
})

test('over HTTP the client keeps the session id, reads JSON and event-stream answers, and ends the session on close', async () => {
  // A stand-in driver speaking MCP's Streamable HTTP: JSON for initialize, an event stream for a tool call.
  // It serves through node:http on purpose. Once any test in the suite has loaded the service's Hono
  // server (the markdown commands' integration test does), the global Response is Hono's lightweight one,
  // and Bun.serve refuses it ("Expected a Response object") however the fake builds its answers.
  const seen: { method: string; session: string | null }[] = []
  let deleted: string | null = null
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  const server = createServer(async (req, res) => {
    const header = req.headers['mcp-session-id']
    const session = typeof header === 'string' ? header : null
    const answer = (status: number, body: string | null, headers: Record<string, string> = {}) => {
      res.writeHead(status, headers)
      if (body === null) res.end()
      else res.end(body)
    }
    if (req.method === 'DELETE') {
      deleted = session
      return answer(200, null)
    }
    const msg = JSON.parse(await readBody(req)) as {
      id?: number
      method: string
      params?: { name?: string; arguments?: { text?: string } }
    }
    seen.push({ method: msg.method, session })
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      answer(200, JSON.stringify(body), { 'content-type': 'application/json', ...headers })
    if (msg.method === 'initialize')
      return json(
        {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'FakeHttp', version: '0.2' },
          },
        },
        { 'mcp-session-id': 'sess-42' },
      )
    if (msg.method === 'notifications/initialized') return answer(202, null)
    if (msg.method === 'tools/call') {
      const stream = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text}` }], isError: false } })}\n\n`
      return answer(200, stream, { 'content-type': 'text/event-stream' })
    }
    json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no ${msg.method}` } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const client = await McpClient.connect({ url: `http://127.0.0.1:${port}/mcp`, clientName: 'sky-test' })
    const result = await client.callTool('echo', { text: 'over http' })
    await client.close()
    assert({
      given: 'a driver over HTTP',
      should:
        'complete the handshake, send the session id on every later call, read the answer out of the stream, and end the session',
      actual: {
        server: client.serverInfo,
        text: (result.content[0] as { text: string }).text,
        sessions: seen.map((s) => `${s.method}:${s.session ?? '-'}`),
        deleted,
      },
      expected: {
        server: { name: 'FakeHttp', version: '0.2' },
        text: 'echo: over http',
        sessions: ['initialize:-', 'notifications/initialized:sess-42', 'tools/call:sess-42'],
        deleted: 'sess-42',
      },
    })
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
