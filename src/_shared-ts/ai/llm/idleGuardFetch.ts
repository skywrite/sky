/**
 * Guard streaming fetches against wedged sockets.
 *
 * A live model stream delivers bytes constantly (deltas, SSE pings), so a long
 * silent stretch means the connection died without erroring — and with Bun's
 * own fetch timeout disabled, such a socket would hang its caller forever. The
 * guard aborts a streaming request whose network goes idle: before any
 * response has arrived the request is re-issued in place (nothing was
 * consumed, so the retry is invisible to the caller); once the body is
 * streaming, the stream errors so the caller fails fast instead of hanging.
 *
 * Non-streaming requests pass through untouched — they legitimately sit
 * silent for many minutes while the full response is generated server-side.
 */

export interface IdleEvent {
  /** Where the silence happened: awaiting the response, or mid-body. */
  phase: 'response' | 'body'
  /** 1-based attempt that went idle. */
  attempt: number
  /** True when the guard re-issues the request; false when it gives up. */
  retrying: boolean
  idleMs: number
}

export interface IdleGuardOptions {
  /** Abort after this long without response headers, then without body bytes. */
  idleMs: number
  /** Total tries for a request that goes idle before responding (default 3). */
  attempts?: number
  /** Observer for idle events (logging); must not throw. */
  onIdle?: (event: IdleEvent) => void
}

/** Streaming requests declare themselves in their JSON body. */
const STREAM_BODY_MARKER = '"stream":true'

export function withStreamIdleGuard(base: typeof fetch, options: IdleGuardOptions): typeof fetch {
  const { idleMs, attempts = 3, onIdle } = options
  const maxAttempts = Math.max(1, attempts)

  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only guard streaming requests with a re-sendable (string) body.
    const body = init?.body
    if (typeof body !== 'string' || !body.includes(STREAM_BODY_MARKER)) return base(input, init)

    const outer = init?.signal ?? undefined
    for (let attempt = 1; ; attempt++) {
      outer?.throwIfAborted()
      const inner = new AbortController()
      const onOuterAbort = () => inner.abort(outer?.reason)
      outer?.addEventListener('abort', onOuterAbort, { once: true })
      let idle = false
      let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        idle = true
        inner.abort()
      }, idleMs)
      try {
        const response = await base(input, { ...init, signal: inner.signal })
        clearTimeout(timer)
        if (!response.body) {
          outer?.removeEventListener('abort', onOuterAbort)
          return response
        }
        // Headers are in — from here the guard watches the gap between body
        // chunks, but only while the caller is waiting on a read. An idle
        // abort now cannot be retried (part of the stream may already be
        // consumed), so it surfaces as a stream error instead.
        const reader = response.body.getReader()
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            timer = setTimeout(() => {
              idle = true
              inner.abort()
            }, idleMs)
            try {
              const { done, value } = await reader.read()
              clearTimeout(timer)
              if (done) {
                outer?.removeEventListener('abort', onOuterAbort)
                controller.close()
              } else {
                controller.enqueue(value)
              }
            } catch (err) {
              clearTimeout(timer)
              outer?.removeEventListener('abort', onOuterAbort)
              if (idle && !outer?.aborted) {
                onIdle?.({ phase: 'body', attempt, retrying: false, idleMs })
                controller.error(
                  new Error(
                    `AI stream went silent for ${Math.round(idleMs / 1000)}s mid-response — connection aborted`,
                  ),
                )
              } else {
                controller.error(err)
              }
            }
          },
          cancel(reason) {
            clearTimeout(timer)
            outer?.removeEventListener('abort', onOuterAbort)
            return reader.cancel(reason)
          },
        })
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      } catch (err) {
        clearTimeout(timer)
        outer?.removeEventListener('abort', onOuterAbort)
        if (!idle || outer?.aborted) throw err
        const retrying = attempt < maxAttempts
        onIdle?.({ phase: 'response', attempt, retrying, idleMs })
        if (!retrying) {
          throw new Error(
            `No response from the AI provider after ${maxAttempts} attempt(s), each idle for ${Math.round(idleMs / 1000)}s — gave up`,
          )
        }
      }
    }
  }
  return guarded as typeof fetch
}
