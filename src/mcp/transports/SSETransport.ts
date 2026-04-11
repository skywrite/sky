/**
 * SSE (Server-Sent Events) Transport for MCP Server
 * Implements the MCP transport protocol over SSE for Claude API compatibility
 */

import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { BaseTransport } from '../core/Transport.ts'

export interface SSETransportOptions {
  port: number
  hostname?: string
  authToken?: string
}

export class SSETransport extends BaseTransport {
  private server?: ServerType
  private options: SSETransportOptions
  private connections: Set<WritableStreamDefaultWriter> = new Set()

  constructor(options: SSETransportOptions) {
    super()
    this.options = options
  }

  async connect(): Promise<void> {
    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url)

      // Log all incoming requests
      console.log(`[SSE Transport] ${req.method} ${url.pathname}`)
      console.log(`[SSE Transport] Headers:`, Object.fromEntries(req.headers.entries()))

      // Check authentication if token is set (skip for CORS preflight)
      if (this.options.authToken && req.method !== 'OPTIONS') {
        const auth = req.headers.get('Authorization')
        if (auth !== `Bearer ${this.options.authToken}`) {
          return new Response('Unauthorized', { status: 401 })
        }
      }

      // Handle SSE endpoint
      if (url.pathname === '/sse') {
        return this.handleSSE(req)
      }

      // Handle JSON-RPC endpoint (fallback)
      if (url.pathname === '/rpc') {
        return this.handleRPC(req)
      }

      // Handle root
      if (url.pathname === '/') {
        return new Response('MCP SSE Server Running', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }

      console.log(`[SSE Transport] 404 for path: ${url.pathname}`)
      return new Response('Not Found', { status: 404 })
    }

    // Start server
    await new Promise<void>((resolve) => {
      this.server = serve(
        {
          fetch: handler,
          port: this.options.port,
          hostname: this.options.hostname || 'localhost',
        },
        () => {
          console.log(`SSE Transport listening on http://${this.options.hostname || 'localhost'}:${this.options.port}`)
          resolve()
        },
      )
    })
    this.connected = true
  }

  private async handleSSE(req: Request): Promise<Response> {
    console.log(`[SSE Handler] Method: ${req.method}`)

    // Handle POST requests with JSON-RPC body (MCP protocol)
    if (req.method === 'POST') {
      const acceptHeader = req.headers.get('Accept') || ''
      console.log(`[SSE Handler] Accept header: ${acceptHeader}`)

      // Check if client accepts event-stream
      if (acceptHeader.includes('text/event-stream')) {
        console.log('[SSE Handler] Client accepts event-stream, setting up SSE response')

        // Set up SSE headers
        const headers = new Headers({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no', // Disable Nginx buffering
        })

        // Parse the JSON-RPC request body
        const bodyText = await req.text()
        console.log(`[SSE Handler] Received request body:`, bodyText)

        // Create a TransformStream for SSE
        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        // Add to connections
        this.connections.add(writer)

        // Process the message and send response as SSE
        if (this.messageHandler) {
          console.log('[SSE Handler] Processing message with handler')

          // Keep track of this specific connection's writer
          const connectionWriter = writer

          // Process messages for this specific connection
          const processMessage = async (msg: string) => {
            console.log('[SSE Handler] Processing message:', msg)

            // Parse potentially multiple JSON-RPC messages
            const messages = msg
              .trim()
              .split('\n')
              .filter((line) => line.trim())

            for (const messageText of messages) {
              console.log('[SSE Handler] Processing individual message:', messageText)

              // Temporarily override send for this connection
              const originalSend = this.send.bind(this)
              this.send = async (response: string) => {
                console.log('[SSE Handler] Sending SSE response:', response)
                const event = `data: ${response}\n\n`
                await connectionWriter.write(encoder.encode(event))
              }

              // Handle the message
              await this.handleMessage(messageText)

              // Restore original send
              this.send = originalSend
            }
          }

          // Process the initial message(s)
          await processMessage(bodyText)

          // WORKAROUND: Claude's MCP connector has multiple issues:
          // 1. It doesn't send notifications/initialized
          // 2. It may send multiple requests in the same connection
          // 3. It expects the SSE stream to stay open for follow-up requests
          console.log('[SSE Handler] Keeping SSE stream open for potential follow-up requests from Claude')

          // Keep the connection open for 30 seconds to allow multiple requests
          setTimeout(async () => {
            console.log('[SSE Handler] Closing SSE stream after timeout')
            try {
              // Send a close event before closing
              await connectionWriter.write(encoder.encode('event: close\ndata: {}\n\n'))
              await connectionWriter.close()
            } catch (e) {
              console.log('[SSE Handler] Error closing stream:', e)
            }
            this.connections.delete(connectionWriter)
          }, 30000)
        }

        return new Response(readable, { headers })
      } else if (acceptHeader.includes('application/json')) {
        console.log('[SSE Handler] Client accepts JSON, using RPC handler')
        // Return JSON response for non-streaming clients
        return this.handleRPC(req)
      }
    }

    // For GET requests, return a simple SSE stream
    if (req.method === 'GET') {
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

      this.connections.add(writer)

      // Send initial connection event
      writer.write(encoder.encode('event: connected\ndata: {"status":"connected"}\n\n'))

      req.signal.addEventListener('abort', async () => {
        this.connections.delete(writer)
        try {
          await writer.close()
        } catch {
          // Writer may already be closed
        }
      })

      return new Response(readable, { headers })
    }

    return new Response('Method not allowed', { status: 405 })
  }

  private async handleIncomingSSEMessages(body: ReadableStream<Uint8Array>, writer: WritableStreamDefaultWriter) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete messages
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              // Process with message handler
              if (this.messageHandler) {
                await this.handleMessage(data)
              }
            } catch (e) {
              console.error('Failed to parse SSE message:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('SSE message handling error:', error)
    } finally {
      reader.releaseLock()
    }
  }

  private async handleRPC(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      const messageText = await req.text()

      if (!this.messageHandler) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'No message handler configured' },
            id: null,
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          },
        )
      }

      // Process the message and wait for response
      const responsePromise = new Promise<string>((resolve) => {
        const originalHandler = this.messageHandler
        this.messageHandler = async (response: string) => {
          resolve(response)
          this.messageHandler = originalHandler
          return originalHandler ? originalHandler(response) : undefined
        }
      })

      await this.handleMessage(messageText)
      const response = await responsePromise

      return new Response(response, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    }
  }

  async close(): Promise<void> {
    // Close all SSE connections
    for (const writer of this.connections) {
      try {
        await writer.close()
      } catch {
        // Ignore errors on close
      }
    }
    this.connections.clear()

    // Stop the server
    if (this.server) {
      this.server.close()
      this.server = undefined
    }

    this.connected = false
  }

  async send(message: string): Promise<void> {
    const encoder = new TextEncoder()
    const event = `event: message\ndata: ${message}\n\n`
    const encoded = encoder.encode(event)

    // Broadcast to all connected SSE clients
    for (const writer of this.connections) {
      await writer.write(encoded).catch(() => {
        // Remove dead connections
        this.connections.delete(writer)
      })
    }
  }
}
