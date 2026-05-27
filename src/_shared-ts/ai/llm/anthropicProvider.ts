import { createAnthropic } from '@ai-sdk/anthropic'

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

export const anthropic = createAnthropic({ fetch: noTimeoutFetch })
