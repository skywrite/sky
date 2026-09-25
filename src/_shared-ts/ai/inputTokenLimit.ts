import { AsyncLocalStorage } from 'node:async_hooks'
import { REPLY_TOKENS } from '#universal/ai/readingBudget.ts'

/** A rejected model request, before any reply or tool execution has started. */
export class InputTokenLimitError extends Error {
  readonly tokens: number
  readonly limit: number

  constructor(tokens: number, limit: number) {
    super(`The request needs ${tokens} input tokens; ${limit} fit with room for the reply.`)
    this.tokens = tokens
    this.limit = limit
    this.name = 'InputTokenLimitError'
  }
}

/** Leave room for the actual output allowance and small differences in provider counts. */
export function inputTokenLimit(contextWindow: number, outputTokens = REPLY_TOKENS): number {
  return Math.max(0, contextWindow - outputTokens - Math.ceil(contextWindow * 0.01))
}

const windows = new AsyncLocalStorage<number | undefined>()

/** Scoped to one provider call, never the tool loop or other simultaneous chats. */
export function withContextWindow<T>(window: number | undefined, run: () => T): T {
  return windows.run(window, run)
}

/**
 * Count the SDK's actual Anthropic payload, including its tool conversion and
 * native attachments. Only callers that opt into withContextWindow pay for
 * this preflight. No second implementation of the SDK's message serializer.
 */
export function withAnthropicTokenCount(fetcher: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const window = windows.getStore()
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (window === undefined || !url.pathname.endsWith('/messages') || typeof init?.body !== 'string') {
      return fetcher(input, init)
    }
    const body = JSON.parse(init.body) as Record<string, unknown>
    const countBody = Object.fromEntries(
      ['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking'].flatMap((key) =>
        body[key] === undefined ? [] : [[key, body[key]]],
      ),
    )
    const countUrl = new URL(url)
    countUrl.pathname += '/count_tokens'
    let tokens: number | undefined
    try {
      const timeout = AbortSignal.timeout(10_000)
      const response = await fetcher(countUrl, {
        ...init,
        body: JSON.stringify(countBody),
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      })
      if (response.ok) {
        const result = (await response.json()) as { input_tokens?: unknown }
        if (
          typeof result.input_tokens === 'number' &&
          Number.isSafeInteger(result.input_tokens) &&
          result.input_tokens >= 0
        )
          tokens = result.input_tokens
      } else {
        await response.body?.cancel()
      }
    } catch {
      // Counting is an extra endpoint with its own availability and input
      // restrictions. Its failure must not break an otherwise valid chat;
      // the model-boundary overflow retry remains the backstop.
      init.signal?.throwIfAborted()
    }
    const limit = inputTokenLimit(window, typeof body.max_tokens === 'number' ? body.max_tokens : undefined)
    if (tokens !== undefined && tokens > limit) throw new InputTokenLimitError(tokens, limit)
    return fetcher(input, init)
  }) as typeof fetch
}
