import type { LanguageModelUsage } from 'ai'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'

export type { TokenUsage } from '#universal/ai/tokenUsage.ts'
export { addUsage, formatTokens, NO_USAGE, totalInput, usageLine } from '#universal/ai/tokenUsage.ts'

/**
 * The SDK's usage of a call or a loop as the four billed counts. Full-rate
 * input is what the SDK reports as uncached; when a provider leaves that out,
 * it is what remains of the total after the cache's share.
 */
export function tokenUsageOf(usage: LanguageModelUsage): TokenUsage {
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0
  const input = usage.inputTokenDetails.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite)
  return { input, cacheRead, cacheWrite, output: usage.outputTokens ?? 0 }
}
