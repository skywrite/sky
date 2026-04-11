/**
 * HTTP transport for MCP communication
 * Enables remote API access via HTTP/REST endpoints
 */

import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { BaseTransport } from '../core/Transport.ts'

/**
 * Configuration options for HTTP transport
 */
export interface HttpTransportOptions {
  port?: number
  hostname?: string
  cors?: boolean
  authToken?: string
}

/**
 * HTTP request handler type
 */
type HttpHandler = (req: Request) => Promise<Response>

/**
 * Transport implementation using HTTP server
 */
export class HttpTransport extends BaseTransport {
  private server?: ServerType
  private options: Required<HttpTransportOptions>
  private pendingResponses = new Map<string | number, (response: string) => void>()

  constructor(options: HttpTransportOptions = {}) {
    super()
    this.options = {
      port: options.port ?? 8080,
      hostname: options.hostname ?? 'localhost',
      cors: options.cors ?? true,
      authToken: options.authToken ?? '',
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      const handler: HttpHandler = async (req) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          return this.corsResponse(new Response(null, { status: 204 }))
        }

        // Check authentication if token is set
        if (this.options.authToken) {
          const auth = req.headers.get('Authorization')
          if (auth !== `Bearer ${this.options.authToken}`) {
            return new Response('Unauthorized', { status: 401 })
          }
        }

        // Handle different endpoints
        const url = new URL(req.url)

        if (url.pathname === '/rpc' && req.method === 'POST') {
          return await this.handleRpcRequest(req)
        }

        if (url.pathname === '/health' && req.method === 'GET') {
          return this.corsResponse(
            new Response(JSON.stringify({ status: 'ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }

        return new Response('Not Found', { status: 404 })
      }

      // Start HTTP server
      await new Promise<void>((resolve) => {
        this.server = serve(
          {
            fetch: handler,
            port: this.options.port,
            hostname: this.options.hostname,
          },
          () => {
            console.error(`HTTP Transport listening on http://${this.options.hostname}:${this.options.port}`)
            resolve()
          },
        )
      })

      this.connected = true
    } catch (error) {
      this.handleError(new Error(`Failed to start HTTP server: ${error}`))
      throw error
    }
  }

  /**
   * Handle JSON-RPC request over HTTP
   */
  private async handleRpcRequest(req: Request): Promise<Response> {
    try {
      const body = await req.text()

      // Process the message through our handler
      const responsePromise = new Promise<string>((resolve) => {
        const request = JSON.parse(body)
        if (request.id !== undefined) {
          this.pendingResponses.set(request.id, resolve)
        }
      })

      // Handle the incoming message
      await this.handleMessage(body)

      // Wait for response (with timeout)
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const response = await Promise.race([
        responsePromise,
        new Promise<string>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Request timeout')), 30000)
        }),
      ]).finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
        }
      })

      return this.corsResponse(
        new Response(response, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    } catch (error) {
      return this.corsResponse(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `Internal error: ${error}`,
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    }
  }

  /**
   * Add CORS headers if enabled
   */
  private corsResponse(response: Response): Response {
    if (this.options.cors) {
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
    return response
  }

  async send(message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    try {
      // Parse the message to check if it's a response
      const parsed = JSON.parse(message)

      // If this is a response to a pending request, resolve it
      if (parsed.id !== undefined && this.pendingResponses.has(parsed.id)) {
        const resolve = this.pendingResponses.get(parsed.id)!
        this.pendingResponses.delete(parsed.id)
        resolve(message)
      }
    } catch (error) {
      this.handleError(new Error(`Failed to send message: ${error}`))
      throw error
    }
  }

  async close(): Promise<void> {
    this.connected = false

    if (this.server) {
      try {
        this.server.close()
      } catch {
        // Ignore errors during cleanup
      }
      this.server = undefined
    }

    // Clear pending responses
    this.pendingResponses.clear()
  }

  /**
   * Create and start an HTTP transport
   */
  static async create(options?: HttpTransportOptions): Promise<HttpTransport> {
    const transport = new HttpTransport(options)
    await transport.connect()
    return transport
  }
}
