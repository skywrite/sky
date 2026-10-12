import { effortLabel, isEffort } from '#universal/ai/effort.ts'
import type { Run } from './chat.tsx'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Display execution evidence, never today's preset definition, for an earlier mission. */
export function agentModelDetails(run: Pick<Run, 'tool' | 'input' | 'output'>): Record<string, string> | null {
  if (run.tool !== 'google_agent') return null
  const output = record(run.output)
  const recorded = record(output.agentModel)
  const timing = record(output.timing)
  // Older summaries retain model calls in start order: the mission's first request
  // precedes any critique models called by its tools, regardless of their call counts.
  const firstModel = Object.keys(record(timing.models))[0]
  const model = text(recorded.model) ?? firstModel?.slice(firstModel.lastIndexOf('/') + 1)
  const profile = text(recorded.profile) ?? text(timing.profile)
  if (!model && !profile) return null
  const effort = Object.hasOwn(recorded, 'effort') ? recorded.effort : record(run.input).effort
  const serviceTier = text(recorded.serviceTier)
  return {
    model: model ?? 'Not recorded',
    profile: profile ?? 'Not recorded',
    effort: isEffort(effort) ? effortLabel(effort) : 'Not recorded',
    ...(serviceTier ? { 'service tier': serviceTier } : {}),
  }
}
