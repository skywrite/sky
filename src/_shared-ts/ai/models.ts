import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { createOpenAI, openai, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { type JSONValue, type LanguageModel, wrapLanguageModel } from 'ai'
import { ollama } from 'ollama-ai-provider-v2'
import { AI_PROFILES } from '#config'
import { anthropic } from '#shared/ai/llm/anthropicProvider.ts'
import { usageMeter } from '#shared/ai/usageLog.ts'
import { wellFormedPromptMiddleware } from '#shared/ai/wellFormedPrompt.ts'
import { installTimingTelemetry } from '#shared/timing/sdk.ts'
import { PROFILES } from './defaultProfiles.ts'

/**
 * Central registry for AI model selection.
 *
 * Three tiers:
 *   call site -> role      `aiModel('reasoning')`      semantic, stable, model-agnostic
 *   role      -> profile   `reasoning: 'opus-5'`       the swap point
 *   profile   -> provider + model + options            the tuned, comparable unit
 *
 * A profile is exactly three fields. `provider` + `model` are the uniform identity;
 * `options` is the only model-specific part. It holds generic AI-SDK call settings
 * (temperature, maxOutputTokens, ...) AND the provider's own options (effort/thinking
 * for anthropic). The resolver demuxes them into a call: generic -> top level,
 * provider-specific -> `providerOptions[provider]`. Sampling params live in `options`
 * (not top level) on purpose: their validity is model-specific — thinking models 400
 * on `temperature` — so they're set only on profiles whose model accepts them. Per-call
 * needs pass through `overrides` (`aiModel('fast', { temperature: 0 })`), which the
 * resolver drops when the profile's model rejects them.
 *
 * Built on the no-timeout Anthropic provider so long calls don't hit Bun's 300s cap.
 *
 * Chunk 1: foundation only — nothing consumes this yet. Transcription is a different
 * modality (TranscriptionModel, not LanguageModel) and gets its own resolver later,
 * so it is intentionally absent from the roles below.
 */

export type Provider = 'anthropic' | 'openai' | 'ollama' | 'lm-studio'

/** Provider-agnostic AI-SDK call settings. */
export interface CommonOptions {
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
  maxRetries?: number
}

/** Provider-specific option bags. Only anthropic is strongly typed for now. */
interface ProviderOptionsByProvider {
  anthropic: AnthropicProviderOptions
  openai: OpenAIResponsesProviderOptions
  ollama: Record<string, JSONValue>
  'lm-studio': Record<string, JSONValue>
}

/** A named model configuration: identity (`provider` + `model`) plus a per-model `options` bag. */
export interface ModelProfile<P extends Provider = Provider> {
  provider: P
  model: string
  baseUrl?: string
  /**
   * Tokens the host serves in one request, when that is less than a chat may
   * ask to read. A chat's reading budget is fitted to it — see
   * universal/ai/readingBudget.ts. Absent, the model takes any budget.
   */
  contextWindow?: number
  options?: CommonOptions & ProviderOptionsByProvider[P]
}

/** Resolver output — spread directly into generateText / generateObject / streamText. */
export interface ResolvedModel {
  model: LanguageModel
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
  maxRetries?: number
  providerOptions?: Record<string, Record<string, JSONValue>>
}

export type Role = 'reasoning' | 'fast' | 'balanced' | 'vision'

/** Identity builder — infers the provider literal so `options` is checked per-provider. */
export function defineProfile<P extends Provider>(profile: ModelProfile<P>): ModelProfile<P> {
  return profile
}

/** Built-in model profiles live in ./defaultProfiles.ts; re-exported here as part of the registry's public surface. */
export { PROFILES }

export type ProfileName = keyof typeof PROFILES

/** Role -> profile pointers. The swap point: repoint a role to move every call site that uses it. */
export const ROLES = {
  reasoning: 'default-opus-5',
  fast: 'default-haiku-4.5',
  balanced: 'default-sonnet-5',
  vision: 'default-sonnet-5',
} satisfies Record<Role, ProfileName>

const COMMON_KEYS = new Set<string>(['temperature', 'maxOutputTokens', 'topP', 'topK', 'maxRetries'])

let _lmStudioProvider: { baseUrl: string; provider: ReturnType<typeof createOpenAI> } | null = null

function getLmStudioProvider(): ReturnType<typeof createOpenAI> {
  return getLmStudioProviderWith('http://localhost:1234/v1')
}

function getLmStudioProviderWith(baseUrl: string): ReturnType<typeof createOpenAI> {
  if (!_lmStudioProvider || _lmStudioProvider.baseUrl !== baseUrl) {
    _lmStudioProvider = { baseUrl, provider: createOpenAI({ baseURL: baseUrl, apiKey: 'lm-studio' }) }
  }
  return _lmStudioProvider.provider
}

/**
 * Every model the registry hands out is wrapped, so no call site can send a
 * prompt carrying half an emoji — one unpaired surrogate makes the provider
 * reject the entire request body. See wellFormedPromptMiddleware.
 */
function languageModelFor(profile: ModelProfile): LanguageModel {
  return wrapLanguageModel({ model: providerModelFor(profile), middleware: wellFormedPromptMiddleware })
}

function providerModelFor(profile: ModelProfile) {
  switch (profile.provider) {
    case 'openai':
      return openai(profile.model)
    case 'ollama':
      return ollama(profile.model)
    case 'lm-studio':
      return getLmStudioProviderWith(profile.baseUrl ?? process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234/v1')(
        profile.model,
      )
    case 'anthropic':
    default:
      return anthropic(profile.model)
  }
}

/** Sampling params thinking models reject; see resolveProfile. */
const SAMPLING_KEYS = ['temperature', 'topP', 'topK'] as const

/** True when a profile turns on extended thinking. */
function thinkingEnabled(profile: ModelProfile): boolean {
  const thinking = (profile.options as { thinking?: { type?: string } } | undefined)?.thinking
  return thinking !== undefined && thinking.type !== 'disabled'
}

/**
 * Resolve a profile into spread-ready call args, demuxing generic vs provider-specific
 * options. Per-call `overrides` merge over the profile's common options — but sampling
 * params are dropped when the profile enables thinking (those models reject them), so
 * call sites can ask for determinism without tracking which model a profile resolves to.
 */
export function resolveProfile(profile: ModelProfile, overrides?: CommonOptions): ResolvedModel {
  installTimingTelemetry()
  // Every call the model makes lands in the usage log, whoever made it.
  const base = languageModelFor(profile)
  const resolved: ResolvedModel = {
    model: typeof base === 'string' ? base : wrapLanguageModel({ model: base, middleware: usageMeter(profile) }),
  }
  const common = resolved as unknown as Record<string, unknown>
  const providerOptions: Record<string, JSONValue> = {}

  for (const [key, value] of Object.entries(profile.options ?? {})) {
    if (value === undefined) continue
    if (COMMON_KEYS.has(key)) {
      common[key] = value
    } else {
      providerOptions[key] = value as JSONValue
    }
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined || !COMMON_KEYS.has(key)) continue
    common[key] = value
  }

  if (thinkingEnabled(profile)) {
    for (const key of SAMPLING_KEYS) {
      delete common[key]
    }
  }

  if (Object.keys(providerOptions).length > 0) {
    resolved.providerOptions = { [profile.provider]: providerOptions }
  }

  return resolved
}

/** Resolve a semantic role (e.g. `aiModel('reasoning')`) to a configured model. */
export function aiModel(role: Role, overrides?: CommonOptions): ResolvedModel {
  return resolveProfile(PROFILES[ROLES[role]], overrides)
}

/**
 * The model id a role currently resolves to, in canonical API form
 * (e.g. "claude-opus-5") — for call sites that record the model identity
 * in their output (summary headings, logs, provenance notes). Mirrors
 * aiModel's resolution: built-in ROLES -> PROFILES.
 */
export function aiModelId(role: Role): string {
  return PROFILES[ROLES[role]].model
}

/**
 * AI-SDK entry points re-exported for consumers outside src's resolution
 * scope (the VS Code extension: its own node_modules walk cannot reach
 * src/node_modules, and importing 'ai' from extension source would load a
 * second copy of the SDK). Importing through the registry guarantees the
 * one instance that also built the model objects.
 */
export { generateText, streamText } from 'ai'

/** Every provider the registry can build, as a list — the settings page offers these. */
export const KNOWN_PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'ollama', 'lm-studio']

const PROVIDERS = new Set<string>(KNOWN_PROVIDERS)

let configProfilesCache: Record<string, ModelProfile> | null = null

/** User-defined profiles from ~/.sky/config.jsonc (ai.profiles), validated and converted. */
function configProfiles(): Record<string, ModelProfile> {
  if (configProfilesCache) return configProfilesCache
  const out: Record<string, ModelProfile> = {}
  for (const [name, def] of Object.entries(AI_PROFILES)) {
    if (!def || typeof def.model !== 'string' || !PROVIDERS.has(def.provider)) {
      console.warn(`Skipping invalid AI profile "${name}" in ~/.sky/config.jsonc (needs a known provider + a model)`)
      continue
    }
    out[name] = { provider: def.provider, model: def.model, baseUrl: def.baseUrl, options: def.options } as ModelProfile
  }
  configProfilesCache = out
  return out
}

/** All profiles: the built-in defaults plus user profiles from config (config wins on a name clash). */
export function getAllProfiles(): Record<string, ModelProfile> {
  return { ...PROFILES, ...configProfiles() }
}

/** Look up a model profile by name; throws if unknown. */
export function getProfile(name: string): ModelProfile {
  const all = getAllProfiles()
  const profile = all[name]
  if (!profile) {
    throw new Error(`Unknown model profile: "${name}". Known profiles: ${Object.keys(all).sort().join(', ')}`)
  }
  return profile
}

/** Resolve a model profile by name — for direct addressing (e.g. a --reasoning flag or an A/B compare UI). */
export function aiModelByProfile(name: string, overrides?: CommonOptions): ResolvedModel {
  return resolveProfile(getProfile(name), overrides)
}
