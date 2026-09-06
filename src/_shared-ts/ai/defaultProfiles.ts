import { defineProfile, type ModelProfile } from './models.ts'

/**
 * Built-in ("default-") model profiles — the shipped catalog of named configs.
 *
 * The `default-` prefix marks these as the built-in set; user-defined profiles
 * (eventually from ~/.sky/config.jsonc) can be named freely. Adding a profile here
 * only makes it *available* — it goes live when a role points at it (see ROLES in
 * models.ts) or you address it directly via aiModelByProfile(name).
 *
 * Model ids stay in their canonical API form (claude-opus-5, gpt-5.5); the profile
 * key is just a label. Sampling params (temperature/topP) belong only on profiles
 * whose model accepts them — thinking/reasoning models (Fable 5/5.1, Opus 5, Opus 4.7/4.8,
 * Sonnet 5, GPT-5.x) 400 on them, so those carry effort/thinking instead.
 */
export const PROFILES = {
  // Fable 5.1 thinks unconditionally (no `disabled`, no budget) and rejects forced tool
  // choice; nothing in the registry's callers forces one, so the profile keeps Fable 5's
  // shape — effort steers the depth, `thinking` keeps resolveProfile's sampling guard armed.
  'default-fable-5.1': defineProfile({
    provider: 'anthropic',
    model: 'claude-fable-5-1',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }),
  // Same model one effort rung down: the API's default depth, for work that does
  // not repay xhigh's longer turns.
  'default-fable-5.1-high': defineProfile({
    provider: 'anthropic',
    model: 'claude-fable-5-1',
    options: { effort: 'high', thinking: { type: 'adaptive' } },
  }),
  'default-fable-5': defineProfile({
    provider: 'anthropic',
    model: 'claude-fable-5',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }),
  // Opus 5 thinks by default, so `thinking` is redundant to the API — but it is what
  // resolveProfile's thinkingEnabled() reads to strip sampling params, and this model
  // 400s on temperature/topP/topK. Stating it keeps that guard armed.
  'default-opus-5': defineProfile({
    provider: 'anthropic',
    model: 'claude-opus-5',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }),
  'default-opus-4.8': defineProfile({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }),
  'default-opus-4.6': defineProfile({ provider: 'anthropic', model: 'claude-opus-4-6' }),
  'default-sonnet-5': defineProfile({ provider: 'anthropic', model: 'claude-sonnet-5' }),
  'default-sonnet-4.6': defineProfile({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  'default-haiku-4.5': defineProfile({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
  'default-gpt-4o': defineProfile({ provider: 'openai', model: 'gpt-4o' }),
  'default-gpt-5.5': defineProfile({
    provider: 'openai',
    model: 'gpt-5.5',
    options: { reasoningEffort: 'xhigh', serviceTier: 'priority' },
  }),
  'default-local-reasoning': defineProfile({
    provider: 'lm-studio',
    model: 'qwen3.6-35b-a3b',
  }),
  'default-local-fast': defineProfile({
    provider: 'lm-studio',
    model: 'google/gemma-4-e4b',
  }),
  // Qwen 3.8 27B on Cerebras: ~1500 tok/s, reasoning on (`high` is the host's default;
  // stated so a glance at the profile says what runs). The model's own window is 262K;
  // Cerebras serves 131,072 tokens a request on the paid tier (64K free), so a chat's
  // reading budget is fitted to that. The key is the keychain entry cerebras/main —
  // see llm/cerebrasProvider.ts.
  'default-cerebras-qwen-3.8': defineProfile({
    provider: 'cerebras',
    model: 'qwen-3.8-27b',
    contextWindow: 131_072,
    options: { reasoningEffort: 'high' },
  }),
} satisfies Record<string, ModelProfile>
