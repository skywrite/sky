import type { JSONValue, LanguageModel } from 'ai'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { createOpenAI, openai, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { ollama } from 'ollama-ai-provider-v2'
import { anthropic } from '#shared/ai/llm/anthropicProvider.ts'
import { PROFILES } from './defaultProfiles.ts'
import { AI_PROFILES } from '#config'
import { routeAISDKWarningsToLog } from './errorLog.ts'

// Every AI-SDK call site resolves its model through this module, so installing
// the warning router here guarantees it is in place before the first call.
routeAISDKWarningsToLog()

/**
 * Central registry for AI model selection.
 *
 * Three tiers:
 *   call site -> role      `aiModel('reasoning')`      semantic, stable, model-agnostic
 *   role      -> profile   `reasoning: 'opus-4-8'`     the swap point
 *   profile   -> provider + model + options            the tuned, comparable unit
 *
 * A profile is exactly three fields. `provider` + `model` are the uniform identity;
 * `options` is the only model-specific part. It holds generic AI-SDK call settings
 * (temperature, maxOutputTokens, ...) AND the provider's own options (effort/thinking
 * for anthropic). The resolver demuxes them into a call: generic -> top level,
 * provider-specific -> `providerOptions[provider]`. Sampling params live in `options`
 * (not top level) on purpose: their validity is model-specific — thinking models 400
 * on `temperature` — so they're set only on profiles whose model accepts them.
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
  reasoning: 'default-opus-4.8',
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

function languageModelFor(profile: ModelProfile): LanguageModel {
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

/** Resolve a profile into spread-ready call args, demuxing generic vs provider-specific options. */
export function resolveProfile(profile: ModelProfile): ResolvedModel {
  const resolved: ResolvedModel = { model: languageModelFor(profile) }
  if (!profile.options) return resolved

  const common = resolved as unknown as Record<string, unknown>
  const providerOptions: Record<string, JSONValue> = {}

  for (const [key, value] of Object.entries(profile.options)) {
    if (value === undefined) continue
    if (COMMON_KEYS.has(key)) {
      common[key] = value
    } else {
      providerOptions[key] = value as JSONValue
    }
  }

  if (Object.keys(providerOptions).length > 0) {
    resolved.providerOptions = { [profile.provider]: providerOptions }
  }

  return resolved
}

/** Resolve a semantic role (e.g. `aiModel('reasoning')`) to a configured model. */
export function aiModel(role: Role): ResolvedModel {
  return resolveProfile(PROFILES[ROLES[role]])
}

const PROVIDERS = new Set<string>(['anthropic', 'openai', 'ollama', 'lm-studio'])

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
export function aiModelByProfile(name: string): ResolvedModel {
  return resolveProfile(getProfile(name))
}
