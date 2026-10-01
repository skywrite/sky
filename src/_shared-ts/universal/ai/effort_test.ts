import { assert, test } from '#test'
import {
  EFFORTS,
  effectiveEffort,
  effortLevels,
  modelDefaultEffort,
  optionsWithEffort,
  presetEffort,
  validateEffort,
} from './effort.ts'

// Opus 5.5 joined the catalog on 2026-09-22; an unlisted model advertises
// only its preset's own level, which made `--ai-effort low` fail on it.
test('effort levels for Opus 5.5', () => {
  const profile = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }
  assert({
    given: 'the Opus 5.5 model',
    should: 'advertise every effort level, as Opus 5 did',
    actual: effortLevels(profile),
    expected: EFFORTS,
  })
  assert({
    given: 'the Sonnet 5.5 model with no preset effort',
    should: 'advertise every effort level, as Sonnet 5 does',
    actual: effortLevels({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
    expected: EFFORTS,
  })
  let rejected: string | undefined
  try {
    validateEffort(profile, 'low')
  } catch (error) {
    rejected = (error as Error).message
  }
  assert({
    given: 'a low override on that model',
    should: 'validate',
    actual: rejected,
    expected: undefined,
  })
})

test('effort levels for GPT-6.1 Sol', () => {
  assert({
    given: 'the GPT-6.1 Sol model with no preset effort',
    should: 'advertise every effort level, as GPT-6 Astra does',
    actual: effortLevels({ provider: 'openai', model: 'gpt-6.1-sol' }),
    expected: EFFORTS,
  })
})

test('inherited effort resolves the known API default without setting preset options', () => {
  const sol = { provider: 'openai', model: 'gpt-6.1-sol' }
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
  assert({
    given: 'Sol 6.1 and Sonnet 5.5 presets without explicit effort',
    should: 'display Medium and High while keeping the presets on API defaults',
    actual: [effectiveEffort(sol), effectiveEffort(sonnet), presetEffort(sol), presetEffort(sonnet)],
    expected: ['medium', 'high', null, null],
  })
  assert({
    given: 'supported Claude models and dated snapshots',
    should: 'use each model family’s API default',
    actual: [
      modelDefaultEffort({ provider: 'anthropic', model: 'claude-opus-5-5-20260922' }),
      modelDefaultEffort({ provider: 'anthropic', model: 'claude-fable-5-1' }),
      modelDefaultEffort({ provider: 'anthropic', model: 'claude-sonnet-5-5-20260928' }),
      modelDefaultEffort({ provider: 'openai', model: 'gpt-6.1-sol-20260929' }),
    ],
    expected: ['medium', 'high', 'high', 'medium'],
  })
})

test('explicit effort wins and clearing it restores the model default', () => {
  const profile = {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    options: { reasoningEffort: 'max', serviceTier: 'priority' },
  }
  const cleared = optionsWithEffort(profile, null)
  assert({
    given: 'a Max preset reset to the model default',
    should: 'restore Medium, retain other options, and leave the original preset intact',
    actual: [effectiveEffort(profile), effectiveEffort({ ...profile, options: cleared }), cleared, profile.options],
    expected: ['max', 'medium', { serviceTier: 'priority' }, { reasoningEffort: 'max', serviceTier: 'priority' }],
  })
  assert({
    given: 'unfamiliar models, unsupported providers, and explicit provider-specific effort',
    should: 'avoid inventing a default or replacing an unfamiliar explicit value',
    actual: [
      effectiveEffort({ provider: 'anthropic', model: 'sample-model' }),
      effectiveEffort({ provider: 'lm-studio', model: 'gpt-6.1-sol' }),
      effectiveEffort({ provider: 'openai', model: 'gpt-6.1-sol', options: { reasoningEffort: 'none' } }),
      effectiveEffort({ provider: 'anthropic', model: 'claude-sonnet-5-5', options: { effort: 'custom' } }),
      effectiveEffort({ provider: 'anthropic', model: 'sample-model', options: { effort: 'low' } }),
    ],
    expected: [null, null, null, null, 'low'],
  })
})
