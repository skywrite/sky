import { z } from 'zod'
import type { ModelProfile } from '#shared/ai/models.ts'
import { isEffortOverride } from '#universal/ai/effort.ts'
import type { ChatSettingsHost, ThreadPrefs, ThreadRestore } from './mod.ts'

const modelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama', 'lm-studio', 'cerebras']),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  options: z.record(z.string(), z.json()).optional(),
})

/** Preserve the actual configuration, so editing a named preset cannot change an existing conversation's provider. */
export function storedModelConfig(value: unknown): ModelProfile | undefined {
  const parsed = modelConfigSchema.safeParse(value)
  return parsed.success ? (parsed.data as ModelProfile) : undefined
}

export function restoredModelPrefs(
  prefs: ThreadPrefs,
  restore: ThreadRestore | undefined,
  catalog: ChatSettingsHost | undefined,
): ThreadPrefs {
  if (!restore) return prefs
  const recovery = restore.resume?.recovery
  const host = recovery?.host
  const last = restore.state.contextLog.findLast((entry) => entry.settings)?.settings
  return {
    ...prefs,
    modelSettingsLocked:
      prefs.modelSettingsLocked === true || restore.state.conversation.length > 0 || !!restore.interrupted,
    modelConfig: prefs.modelConfig ?? storedModelConfig(host?.modelConfig),
    profile:
      prefs.profile ??
      (typeof host?.profile === 'string' ? host.profile : undefined) ??
      last?.preset ??
      (last && catalog?.profileFor?.(last.model, catalog.defaultModel)),
    effort: prefs.effort ?? (isEffortOverride(host?.effort) ? host.effort : undefined) ?? last?.effort ?? 'default',
    contextTokens:
      prefs.contextTokens ??
      recovery?.contextTokens ??
      last?.contextTokens ??
      restore.state.contextLog.findLast((entry) => entry.stats?.budget !== undefined)?.stats?.budget,
  }
}
