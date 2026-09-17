import { addUsage, NO_USAGE, type TokenUsage } from '#universal/ai/tokenUsage.ts'
import type { ContextTurnLog } from './ContextLog/mod.ts'

/** This file's own work only. Inherited turns and child threads are counted in their owning files. */
export interface ChatStatistics {
  messages: number
  replies: number
  wallMs: number
  usage: TokenUsage
  models: Record<string, { calls: number; ms: number; usage: TokenUsage }>
  tools: Record<string, { calls: number; ms: number }>
}

export function chatStatistics(entries: ContextTurnLog[], messages: number): ChatStatistics {
  const result: ChatStatistics = {
    messages,
    replies: Math.floor(messages / 2),
    wallMs: 0,
    usage: { ...NO_USAGE },
    models: {},
    tools: {},
  }
  for (const entry of entries) {
    const timing = entry.timing
    result.wallMs += timing?.wallMs ?? 0
    const models = Object.entries(timing?.models ?? {})
    if (models.length) {
      for (const [name, model] of models) {
        const prior = result.models[name] ?? { calls: 0, ms: 0, usage: { ...NO_USAGE } }
        result.models[name] = {
          calls: prior.calls + model.count,
          ms: prior.ms + model.ms,
          usage: addUsage(prior.usage, model.usage),
        }
        result.usage = addUsage(result.usage, model.usage)
      }
    } else if (entry.usage) {
      result.usage = addUsage(result.usage, entry.usage)
      const name = entry.settings?.model ?? 'unknown'
      const prior = result.models[name] ?? { calls: 0, ms: 0, usage: { ...NO_USAGE } }
      result.models[name] = { ...prior, usage: addUsage(prior.usage, entry.usage) }
    }
    if (timing && Object.keys(timing.tools).length) {
      for (const [name, tool] of Object.entries(timing.tools)) {
        const prior = result.tools[name] ?? { calls: 0, ms: 0 }
        result.tools[name] = { calls: prior.calls + tool.count, ms: prior.ms + tool.ms }
      }
    } else {
      for (const tool of entry.tools ?? []) {
        const prior = result.tools[tool.tool] ?? { calls: 0, ms: 0 }
        result.tools[tool.tool] = { ...prior, calls: prior.calls + 1 }
      }
    }
  }
  return result
}
