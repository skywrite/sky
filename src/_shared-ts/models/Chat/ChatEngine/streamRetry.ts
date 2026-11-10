import { setTimeout as delay } from 'node:timers/promises'
import type { LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

/** The providers classify overloads and server errors; quota/auth/input errors must not be guessed retryable. */
function retryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'isRetryable' in error && error.isRetryable === true
}

function prelude(part: LanguageModelV4StreamPart): boolean {
  return (
    part.type === 'stream-start' ||
    part.type === 'ping' ||
    part.type === 'response-metadata' ||
    part.type === 'reasoning-start' ||
    part.type === 'reasoning-delta' ||
    part.type === 'reasoning-end'
  )
}

/** Return the inspected prefix and then continue streaming, including live tool arguments. */
function replayPrefix(
  prefix: LanguageModelV4StreamPart[],
  reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>,
  done: boolean,
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of prefix) controller.enqueue(part)
      if (done) {
        reader.releaseLock()
        controller.close()
      }
    },
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          reader.releaseLock()
          controller.close()
        } else controller.enqueue(next.value)
      } catch (error) {
        reader.releaseLock()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

/**
 * Retry only this model request, before text or tool activity escapes it.
 * SDK streamRetries also replays steps with partial text or provider-run tools.
 * Holding just metadata/reasoning keeps those effects out of our retry window
 * and preserves incremental tool progress once a request produces output.
 */
export function streamRetryMiddleware({
  maxRetries = 2,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
}: {
  maxRetries?: number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
} = {}): LanguageModelMiddleware {
  return {
    async wrapStream({ doStream, params }) {
      // Opening failures retain the SDK's normal HTTP retry policy.
      let result = await doStream()
      for (let attempt = 0; ; attempt++) {
        const reader = result.stream.getReader()
        const prefix: LanguageModelV4StreamPart[] = []
        let failure: unknown
        try {
          while (true) {
            params.abortSignal?.throwIfAborted()
            const next = await reader.read()
            if (next.done) return { ...result, stream: replayPrefix(prefix, reader, true) }
            if (next.value.type === 'error' && attempt < maxRetries && retryable(next.value.error)) {
              failure = next.value.error
              break
            }
            prefix.push(next.value)
            if (!prelude(next.value)) return { ...result, stream: replayPrefix(prefix, reader, false) }
          }
        } catch (error) {
          await reader.cancel(error).catch(() => {})
          reader.releaseLock()
          throw error
        }
        await reader.cancel(failure).catch(() => {})
        reader.releaseLock()
        await wait(1000 * 2 ** attempt, params.abortSignal)
        params.abortSignal?.throwIfAborted()
        try {
          result = await doStream()
        } catch (error) {
          // Do not re-enter the outer HTTP retry loop and reset this request's
          // attempt limit if reopening the stream fails.
          return {
            ...result,
            stream: new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                controller.enqueue({ type: 'error', error })
                controller.close()
              },
            }),
          } satisfies LanguageModelV4StreamResult
        }
      }
    },
  }
}
