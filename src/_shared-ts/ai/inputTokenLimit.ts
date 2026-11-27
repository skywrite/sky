import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { REPLY_TOKENS } from '#universal/ai/readingBudget.ts'

// Messages and count_tokens both have a 32 MB HTTP body limit, independently of tokens.
export const ANTHROPIC_REQUEST_BYTES = 32_000_000

export class RequestBodyLimitError extends Error {
  readonly bytes: number
  readonly limit: number

  constructor(bytes: number, limit: number) {
    super(`The request body needs ${bytes} bytes; the provider accepts ${limit}.`)
    this.bytes = bytes
    this.limit = limit
    this.name = 'RequestBodyLimitError'
  }
}

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

/**
 * Whether a provider's requests are counted by the provider itself, in its fetch (the wrappers
 * below). Every other host is measured by a conservative estimate of two characters a token,
 * about double the real count, so a chat on it is treated as full at half its window. A cloud
 * provider with a counting endpoint belongs here, with a wrapper of its own.
 */
export function countsOwnRequests(provider: string): boolean {
  return provider.startsWith('anthropic') || provider === 'openai.responses' || provider === 'gemini'
}

const windows = new AsyncLocalStorage<number | undefined>()

/** Scoped to one provider call, never the tool loop or other simultaneous chats. */
export function withContextWindow<T>(window: number | undefined, run: () => T): T {
  return windows.run(window, run)
}

/** Count native images, files, tools and text after the Responses SDK serializes them. */
export function withOpenAITokenCount(fetcher: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const window = windows.getStore()
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (window === undefined || !url.pathname.endsWith('/responses') || typeof init?.body !== 'string')
      return fetcher(input, init)
    init.signal?.throwIfAborted()
    const body = JSON.parse(init.body) as Record<string, unknown>
    const countBody = Object.fromEntries(
      [
        'model',
        'input',
        'instructions',
        'tools',
        'tool_choice',
        'parallel_tool_calls',
        'reasoning',
        'text',
        'conversation',
        'previous_response_id',
        'personality',
        'truncation',
      ].flatMap((key) => (body[key] === undefined ? [] : [[key, body[key]]])),
    )
    const countUrl = new URL(url)
    countUrl.pathname += '/input_tokens'
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
      // Counting may be unavailable for a supported generation input. The
      // provider's context rejection remains the backstop; base64 is not prose.
      init.signal?.throwIfAborted()
    }
    const limit = inputTokenLimit(
      window,
      typeof body.max_output_tokens === 'number' ? body.max_output_tokens : undefined,
    )
    if (tokens !== undefined && tokens > limit) throw new InputTokenLimitError(tokens, limit)
    return fetcher(input, init)
  }) as typeof fetch
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
    if (!url.pathname.endsWith('/messages') || typeof init?.body !== 'string') {
      return fetcher(input, init)
    }
    init.signal?.throwIfAborted()
    // Measure the actual UTF-8 body, including base64, tools and JSON escaping,
    // before either endpoint. This guard also covers callers without a token window.
    const bytes = Buffer.byteLength(init.body, 'utf8')
    if (bytes > ANTHROPIC_REQUEST_BYTES) throw new RequestBodyLimitError(bytes, ANTHROPIC_REQUEST_BYTES)
    if (window === undefined) return fetcher(input, init)
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

/**
 * Count the Google SDK's actual Gemini payload with Google's own counter: the system
 * instruction, the tools, native files and the history, as the model will read them. The
 * counter takes the whole request under `generateContentRequest` with the model's path;
 * `contents` alone would leave the system instruction and the tools out.
 */
export function withGeminiTokenCount(fetcher: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const window = windows.getStore()
    const url = new URL(input instanceof Request ? input.url : String(input))
    const call = /^(.*\/(models\/[^/:]+)):(?:streamGenerateContent|generateContent)$/.exec(url.pathname)
    if (window === undefined || !call || typeof init?.body !== 'string') return fetcher(input, init)
    init.signal?.throwIfAborted()
    const body = JSON.parse(init.body) as Record<string, unknown>
    const request = Object.fromEntries(
      ['contents', 'systemInstruction', 'tools', 'toolConfig', 'cachedContent', 'generationConfig'].flatMap((key) =>
        body[key] === undefined ? [] : [[key, body[key]]],
      ),
    )
    const countUrl = new URL(url)
    countUrl.pathname = `${call[1]}:countTokens`
    countUrl.search = ''
    let tokens: number | undefined
    try {
      const timeout = AbortSignal.timeout(10_000)
      const response = await fetcher(countUrl, {
        ...init,
        body: JSON.stringify({ generateContentRequest: { model: call[2], ...request } }),
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      })
      if (response.ok) {
        const result = (await response.json()) as { totalTokens?: unknown }
        if (
          typeof result.totalTokens === 'number' &&
          Number.isSafeInteger(result.totalTokens) &&
          result.totalTokens >= 0
        )
          tokens = result.totalTokens
      } else {
        await response.body?.cancel()
      }
    } catch {
      // Counting is an extra endpoint with its own availability. Its failure must not
      // break an otherwise valid chat; the provider's own rejection remains the backstop.
      init.signal?.throwIfAborted()
    }
    const generation = body.generationConfig as { maxOutputTokens?: unknown } | undefined
    const limit = inputTokenLimit(
      window,
      typeof generation?.maxOutputTokens === 'number' ? generation.maxOutputTokens : undefined,
    )
    if (tokens !== undefined && tokens > limit) throw new InputTokenLimitError(tokens, limit)
    return fetcher(input, init)
  }) as typeof fetch
}
