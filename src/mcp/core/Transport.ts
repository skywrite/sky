/**
 * Transport interface for MCP communication
 * Abstracts the communication layer (stdio, HTTP, WebSocket, etc.)
 */

export interface Transport {
  /**
   * Connect/initialize the transport
   */
  connect(): Promise<void>

  /**
   * Send a message through the transport
   */
  send(message: string): Promise<void>

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: (message: string) => Promise<void>): void

  /**
   * Register a handler for transport errors
   */
  onError(handler: (error: Error) => void): void

  /**
   * Close the transport connection
   */
  close(): Promise<void>

  /**
   * Check if transport is connected
   */
  isConnected(): boolean
}

/**
 * Base implementation with common functionality
 */
export abstract class BaseTransport implements Transport {
  protected messageHandler?: (message: string) => Promise<void>
  protected errorHandler?: (error: Error) => void
  protected connected = false

  abstract connect(): Promise<void>
  abstract send(message: string): Promise<void>
  abstract close(): Promise<void>

  onMessage(handler: (message: string) => Promise<void>): void {
    this.messageHandler = handler
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler
  }

  isConnected(): boolean {
    return this.connected
  }

  protected async handleMessage(message: string): Promise<void> {
    if (this.messageHandler) {
      try {
        await this.messageHandler(message)
      } catch (error) {
        this.handleError(error as Error)
      }
    }
  }

  protected handleError(error: Error): void {
    if (this.errorHandler) {
      this.errorHandler(error)
    } else {
      console.error('Transport error:', error)
    }
  }
}
