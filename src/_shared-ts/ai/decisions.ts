import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  choice,
  noul,
  PermissionDeniedError,
  score,
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
} from '@typesafe-ai/sdk'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { hasKey } from '#shared/ai/keychainAuthFetch.ts'
import { createTypeSafeClient, JEV_MODEL, MISSING_TYPESAFE_KEY, TYPESAFE_SECRET } from '#shared/ai/typesafe/client.ts'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { readSkyConfigFile } from '#shared/config/loader.ts'
import type { SkyConfig } from '#shared/config/types.ts'

/**
 * Central registry for decision model selection (sibling to models.ts).
 *
 * Three tiers — the same swap point as language models:
 *   call site -> role      `decisionModel('default')`         semantic, stable, model-agnostic
 *   role      -> profile   `default: 'default-typesafe-jev'`  the swap point
 *   profile   -> provider + model (+ optional baseUrl)        the tuned, comparable unit
 *
 * Decision models answer typed questions (`choice`, `score`, `noul`) about a state with
 * calibrated probabilities and never write text, so they live beside the language-model
 * registry rather than inside it.
 */

export { choice, noul, score }

export type DecisionProvider = 'typesafe'
export type DecisionRole = 'default'

export type DecisionQuestions = Questions
export type DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> = SystemOneRequest<Q>
export type DecisionResult<Q extends DecisionQuestions = DecisionQuestions> = SystemOneResult<Q>
export type DecisionCallOptions = RequestOptions & { sink?: (record: AIUsageRecord) => void | Promise<void> }

/** A named decision model configuration: identity (`provider` + `model`) plus optional host metadata. */
export interface DecisionProfile<P extends DecisionProvider = DecisionProvider> {
  provider: P
  model: string
  baseUrl?: string
  contextWindow?: number
  /** What pickers and Settings call this profile; absent, they show the model's name. */
  label?: string
}

/** Identity builder — infers the provider literal so profile declarations stay checked per-provider. */
export function defineDecisionProfile<P extends DecisionProvider>(profile: DecisionProfile<P>): DecisionProfile<P> {
  return profile
}

/** Built-in ("default-") decision model profiles — the shipped catalog of named configs. */
export const DECISION_PROFILES = {
  'default-typesafe-jev': defineDecisionProfile({
    provider: 'typesafe',
    model: JEV_MODEL,
    label: 'TypeSafe Jev',
    contextWindow: 64_000,
  }),
} satisfies Record<string, DecisionProfile>

export type DecisionProfileName = keyof typeof DECISION_PROFILES

/** Role -> profile pointers. The swap point: repoint a role to move every call site that uses it. */
export const DECISION_ROLES = {
  default: 'default-typesafe-jev',
} satisfies Record<DecisionRole, DecisionProfileName>

/** Every decision provider the registry can build. */
export const KNOWN_DECISION_PROVIDERS: readonly DecisionProvider[] = ['typesafe']

export const DECISION_PROVIDER_LABEL: Record<DecisionProvider, string> = {
  typesafe: 'TypeSafe',
}

const PROVIDERS = new Set<string>(KNOWN_DECISION_PROVIDERS)

export interface DecisionModelOptions {
  secrets?: SecretsProvider
  fetch?: typeof fetch
}

/** A resolved decision model ready to ask typed questions and log usage automatically. */
export interface DecisionModel {
  readonly profile: DecisionProfile
  readonly provider: DecisionProvider
  readonly model: string
  /** Whether credentials for this profile's provider exist in the secrets store (presence only). */
  hasKey: () => Promise<boolean>
  /** Ask typed questions about a state; usage is recorded automatically. */
  ask: <const Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
    options?: DecisionCallOptions,
  ) => Promise<DecisionResult<Q>>
}

let _defaultSecrets: SecretsProvider | null = null
function defaultSecrets(): SecretsProvider {
  _defaultSecrets ??= new KeychainSecretsProvider()
  return _defaultSecrets
}

/** User-defined decision profiles from ~/.sky/config.jsonc (ai.decisionProfiles), validated and converted. */
function configDecisionProfiles(config: SkyConfig['ai'] | undefined): Record<string, DecisionProfile> {
  const out: Record<string, DecisionProfile> = {}
  for (const [name, def] of Object.entries(config?.decisionProfiles ?? {})) {
    if (!def || typeof def.model !== 'string' || !def.model.trim() || !PROVIDERS.has(def.provider)) {
      console.warn(
        `Skipping invalid AI decision profile "${name}" in ~/.sky/config.jsonc (needs a known decision provider + a model)`,
      )
      continue
    }
    const builtin = (DECISION_PROFILES as Record<string, DecisionProfile>)[name]
    const sameModel =
      builtin?.provider === def.provider && builtin.model === def.model && builtin.baseUrl === def.baseUrl
    out[name] = {
      provider: def.provider as DecisionProvider,
      model: def.model.trim(),
      baseUrl: def.baseUrl,
      contextWindow: def.contextWindow ?? (sameModel ? builtin.contextWindow : undefined),
      label: sameModel ? builtin.label : undefined,
    }
  }
  return out
}

/** Read fresh so Settings and commands agree without restarting the service. */
export function getDecisionRoles(config = readSkyConfigFile()?.parsed.ai): Record<DecisionRole, string> {
  return Object.fromEntries(
    Object.entries(DECISION_ROLES).map(([role, fallback]) => [
      role,
      config?.decisionRoles?.[role as DecisionRole] ?? fallback,
    ]),
  ) as Record<DecisionRole, string>
}

export function decisionRoleProfile(role: DecisionRole = 'default', config = readSkyConfigFile()?.parsed.ai): string {
  return getDecisionRoles(config)[role]
}

/** All decision profiles: the built-in defaults plus user profiles from config (config wins on a name clash). */
export function getAllDecisionProfiles(config = readSkyConfigFile()?.parsed.ai): Record<string, DecisionProfile> {
  return { ...DECISION_PROFILES, ...configDecisionProfiles(config) }
}

/** Look up a decision profile by name; throws if unknown. */
export function getDecisionProfile(name: string, config = readSkyConfigFile()?.parsed.ai): DecisionProfile {
  const all = getAllDecisionProfiles(config)
  const profile = all[name]
  if (!profile) {
    throw new Error(`Unknown decision profile: "${name}". Known profiles: ${Object.keys(all).sort().join(', ')}`)
  }
  return profile
}

/** Resolve a decision profile into a callable, usage-metered model. */
export function resolveDecisionProfile(profile: DecisionProfile, options: DecisionModelOptions = {}): DecisionModel {
  const secrets = options.secrets ?? defaultSecrets()
  switch (profile.provider) {
    case 'typesafe': {
      const client = createTypeSafeClient({
        secrets,
        model: profile.model,
        baseURL: profile.baseUrl,
        fetch: options.fetch,
      })
      return {
        profile,
        provider: profile.provider,
        model: profile.model,
        hasKey: () => hasKey(secrets, TYPESAFE_SECRET),
        ask: (request, callOptions) => askTypeSafe(client, request, callOptions),
      }
    }
  }
}

/** Resolve a semantic decision role (e.g. `decisionModel('default')`) to a configured model. */
export function decisionModel(role: DecisionRole = 'default', options?: DecisionModelOptions): DecisionModel {
  const config = readSkyConfigFile()?.parsed.ai
  return resolveDecisionProfile(getDecisionProfile(decisionRoleProfile(role, config), config), options)
}

/** The canonical model id a decision role currently resolves to (for cache keys, logs, and provenance). */
export function decisionModelId(role: DecisionRole = 'default'): string {
  const config = readSkyConfigFile()?.parsed.ai
  return getDecisionProfile(decisionRoleProfile(role, config), config).model
}

/** Resolve a decision profile by name — for direct addressing or A/B comparison. */
export function decisionModelByProfile(name: string, options?: DecisionModelOptions): DecisionModel {
  const config = readSkyConfigFile()?.parsed.ai
  return resolveDecisionProfile(getDecisionProfile(name, config), options)
}

export function isDecisionTimeoutError(error: unknown): boolean {
  return error instanceof APITimeoutError
}

export function isDecisionMissingKeyError(error: unknown): boolean {
  if (error instanceof Error && error.message === MISSING_TYPESAFE_KEY) return true
  return (
    error instanceof APIConnectionError && error.cause instanceof Error && error.cause.message === MISSING_TYPESAFE_KEY
  )
}

export function isDecisionAuthError(error: unknown): boolean {
  return (
    error instanceof AuthenticationError || error instanceof PermissionDeniedError || isDecisionMissingKeyError(error)
  )
}

export function missingDecisionKeyError(provider: DecisionProvider): Error {
  switch (provider) {
    case 'typesafe':
      return new Error(MISSING_TYPESAFE_KEY)
  }
}
