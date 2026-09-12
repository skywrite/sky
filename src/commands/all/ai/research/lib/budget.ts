import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { ESTIMATE_SLACK, fitBudget, PROMPT_AND_TOOLS_TOKENS, REPLY_TOKENS } from '#universal/ai/readingBudget.ts'

const DEFAULT_CONTEXT_TOKENS = 300_000
const COMPACTED =
  '\n[Research result shortened to fit the context budget. This is partial evidence; use notebook_read with a path and offset or find to recover omitted passages.]'

export function researchBudget(contextTokens = DEFAULT_CONTEXT_TOKENS, contextWindow?: number) {
  const readingTokens = fitBudget(Math.max(0, contextTokens), contextWindow)
  const inputTokens = Math.min(
    readingTokens + PROMPT_AND_TOOLS_TOKENS,
    contextWindow === undefined ? Infinity : Math.max(0, Math.floor((contextWindow - REPLY_TOKENS) / ESTIMATE_SLACK)),
  )
  return { readingTokens, inputTokens }
}

/** Count the complete serialized input, including schemas, call arguments and accumulated results. */
export function researchInputTokens(params: LanguageModelV4CallOptions): number {
  return estimateTokens(JSON.stringify({ prompt: params.prompt, tools: params.tools }))
}

export function researchEvidenceTokens(params: LanguageModelV4CallOptions): number {
  return estimateTokens(JSON.stringify(params.prompt.filter((message) => message.role === 'tool')))
}

/**
 * Applied at the model boundary, so every SDK step (including its closing step)
 * is checked. Only tool evidence may be shortened; instructions, the mission,
 * and tool call/result pairs survive. Never mutate the SDK's retained history.
 */
export function researchBudgetMiddleware(inputTokens: number, readingTokens = inputTokens): LanguageModelMiddleware {
  const fits = (params: LanguageModelV4CallOptions) =>
    researchInputTokens(params) <= inputTokens && researchEvidenceTokens(params) <= readingTokens
  return {
    async transformParams({ params }) {
      if (fits(params)) return params
      const fitted = { ...params, prompt: structuredClone(params.prompt) }
      for (const message of fitted.prompt) {
        if (message.role !== 'tool') continue
        for (const part of message.content) {
          if (part.type !== 'tool-result') continue
          const original = part.output
          const text = original.type === 'text' ? original.value : JSON.stringify(original)
          // Keep the greatest possible excerpt, retiring older results first.
          part.output = { type: 'text', value: COMPACTED }
          if (JSON.stringify(part.output).length >= JSON.stringify(original).length) {
            part.output = original
            continue
          }
          if (!fits(fitted)) continue
          let low = 0
          let high = text.length
          while (low < high) {
            const mid = Math.ceil((low + high) / 2)
            part.output = { type: 'text', value: truncate(text, mid, COMPACTED) }
            if (fits(fitted)) low = mid
            else high = mid - 1
          }
          part.output = { type: 'text', value: truncate(text, low, COMPACTED) }
          return fitted
        }
      }
      throw new Error(
        'Research instructions and tool calls exceed the context budget. Shorten the research brief or increase the reading budget.',
      )
    },
  }
}
