import { defineProfile, type ModelProfile } from './models.ts'

/**
 * Built-in ("default-") model profiles — the shipped catalog of named configs.
 *
 * The `default-` prefix marks these as the built-in set; user-defined profiles
 * (eventually from ~/.sky/config.jsonc) can be named freely. Adding a profile here
 * only makes it *available* — it goes live when a role points at it (see ROLES in
 * models.ts) or you address it directly via aiModelByProfile(name).
 *
 * Model ids stay in their canonical API form (claude-opus-4-8, gpt-5.5); the profile
 * key is just a label. Sampling params (temperature/topP) belong only on profiles
 * whose model accepts them — thinking/reasoning models (Opus 4.7/4.8, GPT-5.x) 400 on
 * them, so those carry effort/thinking instead.
 */
export const PROFILES = {
  'default-opus-4.8': defineProfile({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }),
  'default-opus-4.6': defineProfile({ provider: 'anthropic', model: 'claude-opus-4-6' }),
  'default-sonnet-4.6': defineProfile({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  'default-haiku-4.5': defineProfile({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
  'default-gpt-4o': defineProfile({ provider: 'openai', model: 'gpt-4o' }),
  'default-gpt-5.5': defineProfile({
    provider: 'openai',
    model: 'gpt-5.5',
    options: { reasoningEffort: 'xhigh', serviceTier: 'priority' },
  }),
  'default-lm-studio': defineProfile({
    provider: 'lm-studio',
    model: 'qwen3.6-35b-a3b',
  }),
} satisfies Record<string, ModelProfile>
