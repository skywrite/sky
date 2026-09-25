import type { LanguageModelV4CallOptions, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider'
import { APICallError, type LanguageModelMiddleware, RetryError } from 'ai'
import { InputTokenLimitError, inputTokenLimit, withContextWindow } from '#shared/ai/inputTokenLimit.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import type { ContextAdjustment } from '#universal/ai/contextAdjustment.ts'

export interface RequestNotebook {
  instructions: string
  tokens: number
  /** Relevance-based reassembly; does not change the person's selected allowance. */
  fit(tokens: number): { instructions: string; tokens: number }
}

const EXCERPT =
  '[Tool result shortened to fit the context window. These are excerpts; reread the source for omitted details.]'
const MAX_FIT_ATTEMPTS = 8

/** Only a provider's context rejection can trigger a retry, never a failed tool or an arbitrary error. */
function overflow(error: unknown, outputTokens?: number): { tokens: number; limit: number; window?: number } | null {
  if (error instanceof InputTokenLimitError) return error
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (!APICallError.isInstance(cause) || cause.statusCode !== 400) return null
  let message = cause.message
  try {
    const body = JSON.parse(cause.responseBody ?? '{}')
    message = body.error?.message ?? body.message ?? message
  } catch {
    // Some compatible hosts send plain text. The SDK message still names the error.
  }
  if (typeof message !== 'string') return null
  const anthropic = /prompt is too long: (\d+) tokens > (\d+) maximum/i.exec(message)
  const compatible = /maximum context length is (\d+) tokens[\s\S]*?(?:resulted in|requested) (\d+) tokens/i.exec(
    message,
  )
  if (!anthropic && !compatible) return null
  const tokens = Number(anthropic?.[1] ?? compatible?.[2])
  const window = Number(anthropic?.[2] ?? compatible?.[1])
  return { tokens, window, limit: inputTokenLimit(window, outputTokens) }
}

function resultText(output: LanguageModelV4ToolResultOutput): string | null {
  if (output.type === 'text' || output.type === 'error-text') return output.value
  if (output.type === 'json' || output.type === 'error-json') return JSON.stringify(output.value)
  return null // Native images and documents are not strings to cut.
}

/** A head and tail, explicitly partial. Keep whole Unicode characters at both edges. */
function excerpt(text: string, length: number): string {
  const head = truncate(text, Math.floor(length * 0.8), '')
  const tail = text.slice(-Math.floor(length * 0.2)).replace(/^[\uDC00-\uDFFF]/, '')
  return `${EXCERPT}\n${head}\n[… omitted …]\n${tail}`
}

/**
 * Runs at the SDK model boundary on EVERY step and approval continuation.
 * Refit notebook retrieval first, then excerpt older tool results if needed.
 * The SDK and engine retain the original history. Retrying this one rejected
 * request cannot rerun a tool that already executed in a previous step.
 */
export function requestBudgetMiddleware(options: {
  contextWindow?: number
  notebook?: RequestNotebook
  onAdjustment: (adjustment: ContextAdjustment) => void
}): LanguageModelMiddleware {
  let window = options.contextWindow
  const initialNotebook = options.notebook?.instructions.trim()
  let notebook = options.notebook && { instructions: initialNotebook!, tokens: options.notebook.tokens }
  const shortened = new Map<string, LanguageModelV4ToolResultOutput>()
  const adjustment: ContextAdjustment = { shortenedToolResults: 0 }

  function prepared(params: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
    return {
      ...params,
      prompt: params.prompt.map((message) => {
        if (message.role === 'system' && initialNotebook && message.content === initialNotebook)
          return { ...message, content: notebook!.instructions }
        if (message.role !== 'tool' || shortened.size === 0) return message
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === 'tool-result' && shortened.has(part.toolCallId)
              ? { ...part, output: shortened.get(part.toolCallId)! }
              : part,
          ),
        }
      }),
    }
  }

  function reduce(params: LanguageModelV4CallOptions, failure: { tokens: number; limit: number }): boolean {
    // The provider count measures the whole request. Convert the shortfall
    // back to the assembler's units, then recount after the reduction.
    const estimated = estimateTokens(JSON.stringify({ prompt: params.prompt, tools: params.tools }))
    const remove = Math.max(1, Math.ceil(estimated * (1 - (failure.limit * 0.95) / failure.tokens)))
    if (notebook && notebook.tokens > 0 && options.notebook) {
      const previous = notebook
      const fitted = options.notebook.fit(Math.max(0, notebook.tokens - remove))
      notebook = { ...fitted, instructions: fitted.instructions.trim() }
      if (notebook.instructions.length < previous.instructions.length) {
        adjustment.notebookTokens = notebook.tokens
        return true
      }
    }
    let remaining = remove * 4
    let changed = false
    for (const message of params.prompt) {
      if (message.role !== 'tool') continue
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue
        const text = resultText(part.output)
        if (text === null || text.length <= EXCERPT.length + 600) continue
        const keep = Math.max(400, text.length - remaining - EXCERPT.length - 24)
        const value = excerpt(text, keep)
        if (value.length >= text.length) continue
        shortened.set(part.toolCallId, { type: 'text', value })
        remaining -= text.length - value.length
        changed = true
        if (remaining <= 0) break
      }
      if (remaining <= 0) break
    }
    adjustment.shortenedToolResults = shortened.size
    return changed
  }

  async function invoke<T>(
    params: LanguageModelV4CallOptions,
    provider: string,
    call: (params: LanguageModelV4CallOptions) => PromiseLike<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      params.abortSignal?.throwIfAborted()
      const fitted = prepared(params)
      try {
        // Claude is counted after SDK serialization by its provider fetch.
        // Other hosts use a conservative estimate and the same rejection retry.
        if (window !== undefined && !provider.startsWith('anthropic')) {
          const tokens = Math.ceil(JSON.stringify({ prompt: fitted.prompt, tools: fitted.tools }).length / 2)
          const limit = inputTokenLimit(window, fitted.maxOutputTokens)
          if (tokens > limit) throw new InputTokenLimitError(tokens, limit)
        }
        return await withContextWindow(window, () => call(fitted))
      } catch (error) {
        params.abortSignal?.throwIfAborted()
        const failure = overflow(error, params.maxOutputTokens)
        if (!failure) throw error
        window = failure.window ?? window
        if (attempt >= MAX_FIT_ATTEMPTS || !reduce(fitted, failure))
          throw new Error(
            'This conversation and its attachments still exceed the model’s capacity after reducing notebook reading and earlier tool results. Try a model with a larger context window or start a new chat with the relevant material.',
          )
        options.onAdjustment({ ...adjustment })
      }
    }
  }

  return {
    wrapStream: ({ params, model }) => invoke(params, model.provider, (fitted) => model.doStream(fitted)),
    wrapGenerate: ({ params, model }) => invoke(params, model.provider, (fitted) => model.doGenerate(fitted)),
  }
}
