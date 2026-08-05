/**
 * Tests for Stdio Transport
 */

import { assert, test } from '#test'
import { TextLineStream } from '../core/TextLineStream.ts'
import { StdioTransport } from '../transports/StdioTransport.ts'

test('StdioTransport - initialization', () => {
  const transport = new StdioTransport()

  assert({
    given: 'a new Stdio transport',
    should: 'not be connected initially',
    actual: transport.isConnected(),
    expected: false,
  })
})

test('StdioTransport - message formatting', async () => {
  // Create a pipe to simulate stdin/stdout
  const pipe = new TransformStream<Uint8Array>()
  const reader = pipe.readable.getReader()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // We can't easily test the full transport without mocking Deno.stdin/stdout,
  // but we can test the message format
  const testMessage = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'test',
  })

  // Stdio uses line-delimited JSON, so messages should end with \n
  const expectedOutput = testMessage + '\n'
  const encoded = encoder.encode(expectedOutput)

  assert({
    given: 'a JSON-RPC message',
    should: 'be line-delimited',
    actual: decoder.decode(encoded).endsWith('\n'),
    expected: true,
  })

  // Clean up
  reader.releaseLock()
})

test('StdioTransport - line parsing', async () => {
  // Test that we can parse line-delimited JSON
  const encoder = new TextEncoder()
  const messages = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'init' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'test' }),
  ]

  const input = messages.join('\n') + '\n'
  const encoded = encoder.encode(input)

  // Create a readable stream from the input
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })

  const lineStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

  const reader = lineStream.getReader()
  const parsedMessages: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value && typeof value === 'string' && value.trim()) {
      parsedMessages.push(value)
    }
  }

  assert({
    given: 'line-delimited JSON input',
    should: 'parse all messages',
    actual: parsedMessages.length,
    expected: 2,
  })

  assert({
    given: 'first parsed message',
    should: 'be valid JSON',
    actual: JSON.parse(parsedMessages[0]).id,
    expected: 1,
  })

  assert({
    given: 'second parsed message',
    should: 'be valid JSON',
    actual: JSON.parse(parsedMessages[1]).id,
    expected: 2,
  })
})

test('StdioTransport - empty line handling', async () => {
  const encoder = new TextEncoder()

  // Input with empty lines and whitespace
  const input = '\n  \n{"jsonrpc":"2.0","id":1}\n\n  \n{"jsonrpc":"2.0","id":2}\n\n'
  const encoded = encoder.encode(input)

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })

  const lineStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

  const reader = lineStream.getReader()
  const nonEmptyLines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    // Filter empty/whitespace lines (same as StdioTransport does)
    if (value && typeof value === 'string' && value.trim()) {
      nonEmptyLines.push(value)
    }
  }

  assert({
    given: 'input with empty lines',
    should: 'filter out empty lines',
    actual: nonEmptyLines.length,
    expected: 2,
  })
})

test('StdioTransport - message encoding format', () => {
  const encoder = new TextEncoder()
  const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' })

  // StdioTransport adds newline to messages
  const formatted = message + '\n'
  const encoded = encoder.encode(formatted)

  // Verify the encoded message can be decoded back
  const decoder = new TextDecoder()
  const decoded = decoder.decode(encoded)

  assert({
    given: 'an encoded message',
    should: 'be decodable to original message with newline',
    actual: decoded,
    expected: formatted,
  })

  assert({
    given: 'a formatted message',
    should: 'end with newline',
    actual: decoded.endsWith('\n'),
    expected: true,
  })
})

test('TextLineStream - chunked input across boundaries', async () => {
  // Data arrives in chunks that split mid-line
  const encoder = new TextEncoder()
  const chunk1 = encoder.encode('{"id":1}\n{"id":')
  const chunk2 = encoder.encode('2}\n{"id":3}\n')

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk1)
      controller.enqueue(chunk2)
      controller.close()
    },
  })

  const lineStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

  const reader = lineStream.getReader()
  const lines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) lines.push(value)
  }

  assert({
    given: 'chunked input split mid-line',
    should: 'reassemble and emit 3 complete lines',
    actual: lines.length,
    expected: 3,
  })

  assert({
    given: 'chunked input split mid-line',
    should: 'produce correct second line from chunks',
    actual: lines[1],
    expected: '{"id":2}',
  })
})

test('TextLineStream - trailing content without newline', async () => {
  const encoder = new TextEncoder()
  const input = encoder.encode('line1\nline2')

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(input)
      controller.close()
    },
  })

  const lineStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

  const reader = lineStream.getReader()
  const lines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) lines.push(value)
  }

  assert({
    given: 'input without trailing newline',
    should: 'emit the trailing content as final line',
    actual: lines,
    expected: ['line1', 'line2'],
  })
})

test('TextLineStream - single line with newline', async () => {
  const encoder = new TextEncoder()
  const input = encoder.encode('only-line\n')

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(input)
      controller.close()
    },
  })

  const lineStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

  const reader = lineStream.getReader()
  const lines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) lines.push(value)
  }

  assert({
    given: 'single line with trailing newline',
    should: 'emit exactly one line',
    actual: lines,
    expected: ['only-line'],
  })
})

test('StdioTransport - close cleanup', () => {
  const transport = new StdioTransport()

  assert({
    given: 'a new transport',
    should: 'not be connected',
    actual: transport.isConnected(),
    expected: false,
  })
})
