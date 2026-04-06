/**
 * Core MCP protocol handler
 * Independent of transport mechanism
 */

import type { Transport } from './Transport.ts'

export interface MCPRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: any
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: any
  error?: MCPError
}

export interface MCPError {
  code: number
  message: string
  data?: any
}

export interface MCPCapabilities {
  tools?: {}
  prompts?: {}
  resources?: {}
}

export interface MCPServerInfo {
  name: string
  version: string
}

export interface MCPTool {
  name: string
  description: string
  inputSchema?: any
}

export type RequestHandler = (request: MCPRequest) => Promise<any>

/**
 * Core MCP protocol implementation
 */
export class MCPCore {
  private handlers = new Map<string, RequestHandler>()
  private initialized = false

  constructor(
    private serverInfo: MCPServerInfo,
    private capabilities: MCPCapabilities = { tools: {} },
  ) {
    this.setupDefaultHandlers()
  }

  /**
   * Setup default MCP protocol handlers
   */
  private setupDefaultHandlers(): void {
    // Initialize handler
    this.registerHandler('initialize', async (request) => {
      if (this.initialized) {
        throw this.createError(-32600, 'Already initialized')
      }

      // WORKAROUND: Claude's MCP connector has a bug where it doesn't send
      // the notifications/initialized message after receiving the initialize response.
      // We mark as initialized immediately to work around this issue.
      // See: https://github.com/anthropics/claude-code/issues/1604
      this.initialized = true
      console.log('[MCPCore] Marked as initialized (Claude workaround)')

      return {
        protocolVersion: '2025-06-18',
        capabilities: this.capabilities,
        serverInfo: this.serverInfo,
      }
    })

    // Initialized notification handler (no response needed)
    // Note: Claude doesn't send this due to a bug, but we keep it for spec compliance
    this.registerHandler('notifications/initialized', async () => {
      console.log('[MCPCore] Received notifications/initialized')
      this.initialized = true
      // No response for notifications
      return null
    })

    // Default error for unimplemented methods
    this.registerHandler('prompts/list', async () => {
      throw this.createError(-32601, 'Method not found')
    })

    this.registerHandler('resources/list', async () => {
      throw this.createError(-32601, 'Method not found')
    })
  }

  /**
   * Register a request handler
   */
  registerHandler(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler)
  }

  /**
   * Process an incoming message
   */
  async processMessage(message: string): Promise<string | null> {
    let request: MCPRequest

    try {
      request = JSON.parse(message)
    } catch (error) {
      return JSON.stringify(this.createErrorResponse(null, -32700, 'Parse error'))
    }

    // Validate JSON-RPC format
    if (request.jsonrpc !== '2.0') {
      return JSON.stringify(this.createErrorResponse(request.id || null, -32600, 'Invalid Request'))
    }

    // Check if method exists
    const handler = this.handlers.get(request.method)
    if (!handler) {
      // Check if it's a notification (no ID means no response expected)
      if (request.id === undefined) {
        return null
      }

      return JSON.stringify(this.createErrorResponse(request.id, -32601, 'Method not found'))
    }

    try {
      const result = await handler(request)

      // If it's a notification (no ID), don't send response
      if (request.id === undefined || result === null) {
        return null
      }

      return JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result,
      } as MCPResponse)
    } catch (error) {
      // Don't send error response for notifications
      if (request.id === undefined) {
        console.error(`Error handling notification ${request.method}:`, error)
        return null
      }

      if (this.isMCPError(error)) {
        return JSON.stringify(this.createErrorResponse(request.id, error.code, error.message, error.data))
      }

      return JSON.stringify(
        this.createErrorResponse(request.id, -32603, 'Internal error', { message: (error as Error).message }),
      )
    }
  }

  /**
   * Attach to a transport
   */
  async attach(transport: Transport): Promise<void> {
    transport.onMessage(async (message) => {
      const response = await this.processMessage(message)
      if (response) {
        await transport.send(response)
      }
    })

    transport.onError((error) => {
      console.error('Transport error:', error)
    })
  }

  /**
   * Create an MCP error
   */
  createError(code: number, message: string, data?: any): MCPError {
    return { code, message, data }
  }

  /**
   * Create an error response
   */
  private createErrorResponse(id: number | string | null, code: number, message: string, data?: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: id || 0,
      error: { code, message, data },
    }
  }

  /**
   * Check if an error is an MCP error
   */
  private isMCPError(error: any): error is MCPError {
    return error && typeof error.code === 'number' && typeof error.message === 'string'
  }

  /**
   * Get initialization state
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.initialized = false
  }
}
