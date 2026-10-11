import { z } from 'zod'
import type { ModelProfile } from '#shared/ai/models.ts'
import { isEffortOverride } from '#universal/ai/effort.ts'
import { budgetFromEstimate } from '#universal/ai/readingBudget.ts'
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
  if (!restore) return knownProfile(prefs, catalog)
  const restored = knownProfile(fromRestore(prefs, restore, catalog), catalog)
  const estimate = restored.contextTokens === undefined ? savedEstimate(restore) : undefined
  return estimate === undefined
    ? restored
    : { ...restored, contextTokens: budgetFromEstimate(estimate, ratioOf(restored, catalog)) }
}

/**
 * A chat set to a profile since retired from the catalog opens on the default model, at
 * that model's default effort; looking the old name up would fail the open. A chat that
 * kept its own configuration still runs as saved.
 */
function knownProfile(prefs: ThreadPrefs, catalog: ChatSettingsHost | undefined): ThreadPrefs {
  if (!catalog || !prefs.profile || prefs.modelConfig) return prefs
  if (catalog.choices().some((choice) => choice.name === prefs.profile)) return prefs
  return { ...prefs, profile: catalog.defaultModel, effort: 'default' }
}

function fromRestore(prefs: ThreadPrefs, restore: ThreadRestore, catalog: ChatSettingsHost | undefined): ThreadPrefs {
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
  }
}

/**
 * The budget a thread was saved with, as the estimate its context assembled
 * within: the snapshot's, else the saved file's, else the last turn's, else —
 * for a log older than turn settings — the last assembly's ceiling.
 */
function savedEstimate(restore: ThreadRestore): number | undefined {
  const log = restore.state.contextLog
  return (
    restore.budget ??
    restore.resume?.recovery?.contextTokens ??
    log.findLast((entry) => entry.settings)?.settings?.contextTokens ??
    log.findLast((entry) => entry.stats?.budget !== undefined)?.stats?.budget
  )
}

/**
 * The ratio the restored thread's session reads with, so its budget holds the
 * text it always held — on the model it runs on now, which a retired profile
 * changes. A host that knows no ratio takes the two counts as one.
 */
function ratioOf(prefs: ThreadPrefs, catalog: ChatSettingsHost | undefined): number {
  return catalog?.tokenRatio?.(prefs.profile ?? catalog.defaultModel, prefs.modelConfig) ?? 1
}
