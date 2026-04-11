/**
 * Mock Transport implementation for testing
 */

import { BaseTransport } from '../../core/Transport.ts'

export interface MockMessage {
  direction: 'sent' | 'received'
  message: string
  timestamp: number
}

export class MockTransport extends BaseTransport {
  public messages: MockMessage[] = []
  private responseQueue: string[] = []
  private autoRespond = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async send(message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    this.messages.push({
      direction: 'sent',
      message,
      timestamp: Date.now(),
    })

    // Auto-respond if enabled
    if (this.autoRespond && this.responseQueue.length > 0) {
      const response = this.responseQueue.shift()!
      await this.simulateIncomingMessage(response)
    }
  }

  async close(): Promise<void> {
    this.connected = false
    this.messages = []
    this.responseQueue = []
  }

  /**
   * Simulate an incoming message
   */
  async simulateIncomingMessage(message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    this.messages.push({
      direction: 'received',
      message,
      timestamp: Date.now(),
    })

    await this.handleMessage(message)
  }

  /**
   * Queue a response to be sent when a message is received
   */
  queueResponse(response: string): void {
    this.responseQueue.push(response)
  }

  /**
   * Enable auto-responding with queued responses
   */
  setAutoRespond(enabled: boolean): void {
    this.autoRespond = enabled
  }

  /**
   * Get all sent messages
   */
  getSentMessages(): string[] {
    return this.messages.filter((m) => m.direction === 'sent').map((m) => m.message)
  }

  /**
   * Get all received messages
   */
  getReceivedMessages(): string[] {
    return this.messages.filter((m) => m.direction === 'received').map((m) => m.message)
  }

  /**
   * Get the last sent message
   */
  getLastSentMessage(): string | undefined {
    const sent = this.getSentMessages()
    return sent[sent.length - 1]
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = []
  }

  /**
   * Wait for a message matching a condition
   */
  async waitForMessage(predicate: (message: string) => boolean, timeout = 1000): Promise<string> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const message = this.getSentMessages().find(predicate)
      if (message) {
        return message
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    throw new Error(`Timeout waiting for message after ${timeout}ms`)
  }
}
