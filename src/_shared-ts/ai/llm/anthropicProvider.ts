import { createAnthropic } from '@ai-sdk/anthropic'
import { logAIError } from '#shared/ai/errorLog.ts'
import { withStreamIdleGuard } from './idleGuardFetch.ts'

/**
 * Anthropic provider for the Vercel AI SDK with Bun's default 5-minute (300s) fetch
 * timeout disabled.
 *
 * Long non-streaming calls — e.g. analyzing or rewriting a full meeting transcript —
 * routinely run 6-8 minutes (a single transcript analysis emits ~30k output tokens),
 * and Bun's fetch ceiling was killing the socket at exactly 300s with "operation timed
 * out", regardless of any SDK-level timeout. `timeout: false` is a Bun-specific fetch
 * option; the per-call `timeout` passed to generateText() remains the real upper bound.
 */
const noTimeoutFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, timeout: false } as RequestInit & { timeout: boolean })) as typeof globalThis.fetch

/**
 * With the timeout off, a socket that dies without erroring would hang a
 * stream forever (a google:agent mission died exactly this way). A live
 * stream ticks constantly — deltas, SSE pings — so this much silence means
 * the connection is gone: unanswered requests are re-issued invisibly (the
 * model never started answering), mid-body silences fail fast. Non-streaming
 * requests are exempt; they are quiet by design (see above). Every idle event
 * lands in the AI error log.
 */
const STREAM_IDLE_MS = 90_000

export const anthropic = createAnthropic({
  fetch: withStreamIdleGuard(noTimeoutFetch, {
    idleMs: STREAM_IDLE_MS,
    attempts: 3,
    onIdle: (event) =>
      void logAIError({
        source: 'anthropic-provider',
        stage: 'stream-idle',
        message:
          event.phase === 'response'
            ? `no response for ${Math.round(event.idleMs / 1000)}s (attempt ${event.attempt}) — ${event.retrying ? 'retrying' : 'giving up'}`
            : `stream went silent for ${Math.round(event.idleMs / 1000)}s mid-response — aborted`,
      }),
  }),
})
