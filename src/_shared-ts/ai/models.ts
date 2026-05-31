import type { JSONValue, LanguageModel } from 'ai'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { createOpenAI, openai } from '@ai-sdk/openai'
import { ollama } from 'ollama-ai-provider-v2'
import { anthropic } from '#shared/ai/llm/anthropicProvider.ts'

/**
 * Central registry for AI model selection.
 *
 * Three tiers:
 *   call site -> role      `aiModel('reasoning')`      semantic, stable, model-agnostic
 *   role      -> profile   `reasoning: 'opus-4-6'`     the swap point
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
  openai: Record<string, JSONValue>
  ollama: Record<string, JSONValue>
  'lm-studio': Record<string, JSONValue>
}

/** A named model configuration: identity (`provider` + `model`) plus a per-model `options` bag. */
export interface ModelProfile<P extends Provider = Provider> {
  provider: P
  model: string
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

export type Role = 'reasoning' | 'chat' | 'fast' | 'balanced' | 'vision'

/** Identity builder — infers the provider literal so `options` is checked per-provider. */
export function defineProfile<P extends Provider>(profile: ModelProfile<P>): ModelProfile<P> {
  return profile
}

/**
 * Built-in model profiles. Names are simple model-version keys — rename freely.
 * The baseline is behaviour-preserving: these mirror the models call sites use today,
 * with no `options`, so nothing changes when call sites migrate to roles.
 */
export const PROFILES = {
  'opus-4-6': defineProfile({ provider: 'anthropic', model: 'claude-opus-4-6' }),
  'sonnet-4-6': defineProfile({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  'haiku-4-5': defineProfile({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
  'gpt-4o': defineProfile({ provider: 'openai', model: 'gpt-4o' }),
} satisfies Record<string, ModelProfile>

export type ProfileName = keyof typeof PROFILES

/** Role -> profile pointers. The swap point: repoint a role to move every call site that uses it. */
export const ROLES = {
  reasoning: 'opus-4-6',
  chat: 'opus-4-6',
  fast: 'haiku-4-5',
  balanced: 'sonnet-4-6',
  vision: 'gpt-4o',
} satisfies Record<Role, ProfileName>

const COMMON_KEYS = new Set<string>(['temperature', 'maxOutputTokens', 'topP', 'topK', 'maxRetries'])

const lmStudio = createOpenAI({ baseURL: 'http://localhost:1234/v1', apiKey: 'lm-studio' })

function languageModelFor(profile: ModelProfile): LanguageModel {
  switch (profile.provider) {
    case 'openai':
      return openai(profile.model)
    case 'ollama':
      return ollama(profile.model)
    case 'lm-studio':
      return lmStudio(profile.model)
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

/** Resolve a model profile by name — for direct addressing (e.g. an A/B compare UI). */
export function aiModelByProfile(name: string): ResolvedModel {
  const profile = (PROFILES as Record<string, ModelProfile>)[name]
  if (!profile) {
    throw new Error(`Unknown model profile: "${name}". Known profiles: ${Object.keys(PROFILES).join(', ')}`)
  }
  return resolveProfile(profile)
}
