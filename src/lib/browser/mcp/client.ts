import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import * as readline from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

// Sky talks to a browser driver over MCP. Two transports: newline-delimited
// JSON-RPC 2.0 on a child's stdin and stdout, and Streamable HTTP to a
// driver that outlives the task. Three requests cover a browser task —
// initialize, tools/list, tools/call — so the client is this file rather
// than a dependency. The framing is the standard one, so the official
// client SDK slots in here unchanged should the surface grow.

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpImageContent {
  type: 'image'
  /** Base64 */
  data: string
  mimeType: string
}

export type McpContent = McpTextContent | McpImageContent | { type: string }

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  content: McpContent[]
  /** The tool ran and failed — distinct from a protocol error, which throws. */
  isError: boolean
  structuredContent?: unknown
}

export interface McpServerInfo {
  name: string
  version: string
}

export interface McpClientOptions {
  /** The server: an executable and its arguments */
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  clientName?: string
  /** One line of the server's stderr — diagnostics, never the terminal */
  onStderr?: (line: string) => void
}

export interface CallOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** The server answered a request with an error, or stopped answering. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}

/** How requests reach the driver and answers come back. */
interface Transport {
  request(method: string, params: unknown, options: CallOptions): Promise<unknown>
  notify(method: string, params?: unknown): Promise<void>
  close(): Promise<void>
}

export interface McpHttpOptions {
  /** The driver's MCP endpoint, such as http://localhost:1234/mcp */
  url: string
  clientName?: string
}

const INITIALIZE_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 120_000
const CLOSE_GRACE_MS = 5_000

export class McpClient {
  serverInfo?: McpServerInfo

  private constructor(private readonly transport: Transport) {}

  /** Spawn the driver and complete the MCP handshake. */
  static async start(options: McpClientOptions): Promise<McpClient> {
    const client = new McpClient(await StdioTransport.spawn(options))
    await client.handshake(options.clientName)
    return client
  }

  /** Connect to a driver already serving over HTTP and complete the MCP handshake. */
  static async connect(options: McpHttpOptions): Promise<McpClient> {
    const client = new McpClient(new HttpTransport(options.url))
    await client.handshake(options.clientName)
    return client
  }

  private async handshake(clientName?: string): Promise<void> {
    const result = (await this.transport.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: clientName ?? 'sky', version: '1' },
      },
      { timeoutMs: INITIALIZE_TIMEOUT_MS },
    )) as { serverInfo?: McpServerInfo }
    this.serverInfo = result.serverInfo
    await this.transport.notify('notifications/initialized')
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = []
    let cursor: string | undefined
    do {
      const page = (await this.transport.request('tools/list', cursor ? { cursor } : {}, {
        timeoutMs: INITIALIZE_TIMEOUT_MS,
      })) as { tools: McpToolDefinition[]; nextCursor?: string }
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<McpToolResult> {
    const result = (await this.transport.request(
      'tools/call',
      { name, arguments: args },
      { timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS, signal: options.signal },
    )) as Partial<McpToolResult>
    return {
      content: result.content ?? [],
      isError: result.isError === true,
      structuredContent: result.structuredContent,
    }
  }

  /** End this client's side. A spawned driver is ended with it; a driver over HTTP lives on. */
  close(): Promise<void> {
    return this.transport.close()
  }
}

// -----------------------------------------------------------------------------
// Stdio: a child process, one JSON-RPC message per line
// -----------------------------------------------------------------------------

class StdioTransport implements Transport {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly exited: Promise<number | null>
  private ended = false

  private constructor(
    private readonly child: ChildProcess,
    options: McpClientOptions,
  ) {
    child.stdout!.setEncoding('utf8')
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.receive(line))
    if (options.onStderr) {
      child.stderr!.setEncoding('utf8')
      readline.createInterface({ input: child.stderr! }).on('line', options.onStderr)
    } else child.stderr?.resume()
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => {
        this.ended = true
        this.failPending(new McpError(`The browser server stopped (exit code ${code ?? 'unknown'})`))
        resolve(code)
      })
    })
  }

  static async spawn(options: McpClientOptions): Promise<StdioTransport> {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    return new StdioTransport(child, options)
  }

  /** End the driver: close its stdin, which it exits on, then insist. */
  async close(): Promise<void> {
    if (this.ended) return
    this.child.stdin?.end()
    if ((await this.exitWithin(CLOSE_GRACE_MS)) !== undefined) return
    this.child.kill('SIGTERM')
    if ((await this.exitWithin(CLOSE_GRACE_MS)) !== undefined) return
    this.child.kill('SIGKILL')
    await this.exited
  }

  private exitWithin(ms: number): Promise<number | null | undefined> {
    return Promise.race([this.exited, delay(ms).then(() => undefined)])
  }

  request(method: string, params: unknown, options: CallOptions): Promise<unknown> {
    if (this.ended) return Promise.reject(new McpError('The browser server has stopped'))
    const id = this.nextId++
    const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpError(`${method} did not answer within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      const onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(options.signal?.reason instanceof Error ? options.signal.reason : new McpError('Stopped'))
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = () => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      this.pending.set(id, { resolve, reject, cleanup })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.send(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })
  }

  private send(message: unknown): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string): void {
    if (!line.trim()) return
    let message: { id?: unknown; result?: unknown; error?: { code: number; message: string } }
    try {
      message = JSON.parse(line)
    } catch {
      return // a stray line on stdout is not a protocol message
    }
    if (typeof message.id !== 'number') return // a notification; nothing listens for those yet
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    pending.cleanup()
    if (message.error) pending.reject(new McpError(message.error.message, message.error.code))
    else pending.resolve(message.result)
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.cleanup()
      pending.reject(error)
    }
  }
}

// -----------------------------------------------------------------------------
// HTTP: one POST per request to a driver that keeps running between tasks
// -----------------------------------------------------------------------------

/**
 * MCP's Streamable HTTP, the client half Sky needs: every request is a POST
 * carrying one JSON-RPC message; the answer comes back as JSON, or as an
 * event stream whose data lines hold JSON-RPC messages. The driver hands
 * out a session id on initialize and expects it on every later call.
 */
class HttpTransport implements Transport {
  private nextId = 1
  private session?: string
  private closed = false

  constructor(private readonly url: string) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.session ? { 'mcp-session-id': this.session } : {}),
    }
  }

  async request(method: string, params: unknown, options: CallOptions): Promise<unknown> {
    if (this.closed) throw new McpError('The browser driver session was closed')
    const id = this.nextId++
    const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new McpError(`${method} did not answer within ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    )
    const onAbort = () =>
      controller.abort(options.signal?.reason instanceof Error ? options.signal.reason : new McpError('Stopped'))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let response: Response
      try {
        response = await fetch(this.url, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason
        throw new McpError(
          `The browser driver did not answer: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (!this.session) this.session = response.headers.get('mcp-session-id') ?? undefined
      const body = await response.text()
      if (!response.ok)
        throw new McpError(`The browser driver answered ${response.status}: ${body.slice(0, 200)}`, response.status)
      const type = response.headers.get('content-type') ?? ''
      const messages: { id?: unknown; result?: unknown; error?: { code: number; message: string } }[] = type.includes(
        'text/event-stream',
      )
        ? body
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => JSON.parse(line.slice(5)))
        : [JSON.parse(body)]
      const reply = messages.find((message) => message.id === id)
      if (!reply) throw new McpError(`The browser driver sent no answer to ${method}`)
      if (reply.error) throw new McpError(reply.error.message, reply.error.code)
      return reply.result
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }),
    }).catch(() => undefined)
  }

  /** End the session; the driver and its browser stay up for the next task. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (!this.session) return
    await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.session } }).catch(() => undefined)
  }
}
