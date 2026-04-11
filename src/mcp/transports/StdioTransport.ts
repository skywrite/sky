// @ts-nocheck — bun-types ReadableStream generics conflict with the Readable.toWeb() cast
/**
 * Stdio transport for MCP communication
 */

import process from 'node:process'
import { Readable } from 'node:stream'
import { BaseTransport } from '../core/Transport.ts'
import { TextLineStream } from '../core/TextLineStream.ts'

/**
 * Transport implementation using stdin/stdout
 */
export class StdioTransport extends BaseTransport {
  private reader?: ReadableStreamDefaultReader<string>
  private encoder = new TextEncoder()

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      // Setup stdin reader with line streaming
      const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
      const lineStream = stdin
        .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
        .pipeThrough(new TextLineStream())

      this.reader = lineStream.getReader()

      this.connected = true

      // Start reading messages
      this.startReading()
    } catch (error) {
      this.handleError(new Error(`Failed to connect stdio: ${error}`))
      throw error
    }
  }

  async send(message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    try {
      // MCP uses line-delimited JSON
      const data = this.encoder.encode(message + '\n')
      process.stdout.write(data)
    } catch (error) {
      this.handleError(new Error(`Failed to send message: ${error}`))
      throw error
    }
  }

  async close(): Promise<void> {
    this.connected = false

    if (this.reader) {
      try {
        await this.reader.cancel()
      } catch {
        // Ignore errors during cleanup
      }
      this.reader = undefined
    }
  }

  /**
   * Start reading messages from stdin
   */
  private async startReading(): Promise<void> {
    if (!this.reader) {
      return
    }

    try {
      while (this.connected) {
        const { value, done } = await this.reader.read()

        if (done) {
          break
        }

        if (value && value.trim()) {
          await this.handleMessage(value)
        }
      }
    } catch (error) {
      if (this.connected) {
        this.handleError(new Error(`Error reading from stdin: ${error}`))
      }
    }
  }

  /**
   * Create and start a stdio transport
   */
  static async create(): Promise<StdioTransport> {
    const transport = new StdioTransport()
    await transport.connect()
    return transport
  }
}
