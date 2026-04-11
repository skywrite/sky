import { Buffer } from 'node:buffer'
import process from 'node:process'

const encoder = new TextEncoder()

/** Check if stdin is connected to a TTY */
export function isTerminal(): boolean {
  return !!process.stdin.isTTY
}

/** Enable or disable raw mode on stdin */
export function setRaw(enabled: boolean): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(enabled)
  }
}

/** Get the terminal's column and row count (defaults to 80x24 when not a TTY) */
export function consoleSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  }
}

/** Write data to stdout. Accepts a string or Uint8Array. */
export function writeStdout(data: string | Uint8Array): void {
  const buf = typeof data === 'string' ? encoder.encode(data) : data
  process.stdout.write(buf)
}

/**
 * Read from stdin into a buffer (pull-based, like Deno.stdin.read).
 * Returns the number of bytes read, or null on EOF.
 */
export function readStdin(buf: Uint8Array): Promise<number | null> {
  return new Promise((resolve) => {
    // Ensure stdin is flowing so we can read a chunk
    if (process.stdin.isPaused()) {
      process.stdin.resume()
    }

    const onData = (chunk: Buffer) => {
      cleanup()
      const bytes = Math.min(chunk.length, buf.length)
      buf.set(chunk.subarray(0, bytes))
      // Pause after reading so we don't buffer extra data
      process.stdin.pause()
      resolve(bytes)
    }

    const onEnd = () => {
      cleanup()
      resolve(null)
    }

    const onError = () => {
      cleanup()
      resolve(null)
    }

    function cleanup() {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
    }

    process.stdin.once('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('error', onError)
  })
}
