import { assert, test } from '#test'
import { aiModel, aiModelByProfile, aiModelId, defineProfile, resolveProfile, type ResolvedModel } from './models.ts'

function modelId(m: ResolvedModel['model']): string {
  return (m as { modelId: string }).modelId
}

test('aiModel resolves a role to its baseline profile model', () => {
  assert({
    given: 'the reasoning role',
    should: 'resolve to the opus-4-8 profile model',
    actual: modelId(aiModel('reasoning').model),
    expected: 'claude-opus-4-8',
  })
  assert({
    given: 'the fast role',
    should: 'resolve to the haiku-4-5 profile model',
    actual: modelId(aiModel('fast').model),
    expected: 'claude-haiku-4-5',
  })
  assert({
    given: 'the balanced role',
    should: 'resolve to the sonnet-5 profile model',
    actual: modelId(aiModel('balanced').model),
    expected: 'claude-sonnet-5',
  })
  assert({
    given: 'the vision role',
    should: 'resolve to the sonnet-5 profile model',
    actual: modelId(aiModel('vision').model),
    expected: 'claude-sonnet-5',
  })
})

test('aiModelId exposes the model id behind a role', () => {
  assert({
    given: 'the reasoning role',
    should: 'return the canonical model id for recording in output',
    actual: aiModelId('reasoning'),
    expected: 'claude-opus-4-8',
  })
})

test('option-less baseline profiles carry no providerOptions', () => {
  assert({
    given: 'a baseline profile with no options',
    should: 'omit providerOptions (behaviour-preserving)',
    actual: aiModel('fast').providerOptions,
    expected: undefined,
  })
})

test('the reasoning role carries the opus-4.8 effort/thinking options', () => {
  assert({
    given: 'the reasoning role after the 4.8 repoint',
    should: 'carry effort xhigh under providerOptions.anthropic',
    actual: aiModel('reasoning').providerOptions?.['anthropic']?.['effort'],
    expected: 'xhigh',
  })
})

test('resolveProfile demuxes generic settings from provider-specific options', () => {
  const profile = defineProfile({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    options: { temperature: 0, maxOutputTokens: 1000, effort: 'high' },
  })
  const resolved = resolveProfile(profile)

  assert({
    given: 'a generic call setting (temperature)',
    should: 'hoist it to the top level',
    actual: resolved.temperature,
    expected: 0,
  })
  assert({
    given: 'a generic call setting (maxOutputTokens)',
    should: 'hoist it to the top level',
    actual: resolved.maxOutputTokens,
    expected: 1000,
  })
  assert({
    given: 'a provider-specific option (effort)',
    should: 'namespace it under providerOptions[provider]',
    actual: resolved.providerOptions?.['anthropic']?.['effort'],
    expected: 'high',
  })
  assert({
    given: 'a provider-specific option (effort)',
    should: 'not leak to the top level',
    actual: (resolved as unknown as Record<string, unknown>)['effort'],
    expected: undefined,
  })
})

test('resolveProfile applies sampling overrides on non-thinking profiles', () => {
  const profile = defineProfile({ provider: 'anthropic', model: 'claude-haiku-4-5' })
  const resolved = resolveProfile(profile, { temperature: 0 })

  assert({
    given: 'a temperature override on a profile without thinking',
    should: 'hoist it to the top level',
    actual: resolved.temperature,
    expected: 0,
  })
})

test('resolveProfile drops sampling overrides when the profile enables thinking', () => {
  const resolved = aiModelByProfile('default-opus-4.8', { temperature: 0, maxOutputTokens: 4096 })

  assert({
    given: 'a temperature override on a thinking profile',
    should: 'drop it (thinking models reject sampling params)',
    actual: resolved.temperature,
    expected: undefined,
  })
  assert({
    given: 'a non-sampling override on the same call',
    should: 'still apply',
    actual: resolved.maxOutputTokens,
    expected: 4096,
  })
})

test('default-opus-4.8 profile resolves to opus 4.8 with effort/thinking options', () => {
  const resolved = aiModelByProfile('default-opus-4.8')
  assert({
    given: 'the default-opus-4.8 profile',
    should: 'resolve to claude-opus-4-8',
    actual: modelId(resolved.model),
    expected: 'claude-opus-4-8',
  })
  assert({
    given: 'its effort option',
    should: 'land under providerOptions.anthropic',
    actual: resolved.providerOptions?.['anthropic']?.['effort'],
    expected: 'xhigh',
  })
})

test('default-fable-5 profile resolves to fable 5 with effort/thinking options', () => {
  const resolved = aiModelByProfile('default-fable-5')
  assert({
    given: 'the default-fable-5 profile',
    should: 'resolve to claude-fable-5',
    actual: modelId(resolved.model),
    expected: 'claude-fable-5',
  })
  assert({
    given: 'its effort option',
    should: 'land under providerOptions.anthropic',
    actual: resolved.providerOptions?.['anthropic']?.['effort'],
    expected: 'xhigh',
  })
})

test('default-gpt-5.5 routes openai options under providerOptions.openai', () => {
  const resolved = aiModelByProfile('default-gpt-5.5')
  assert({
    given: 'the default-gpt-5.5 profile',
    should: 'resolve to gpt-5.5',
    actual: modelId(resolved.model),
    expected: 'gpt-5.5',
  })
  assert({
    given: 'its reasoningEffort + serviceTier options',
    should: 'land under providerOptions.openai',
    actual: resolved.providerOptions?.['openai'],
    expected: { reasoningEffort: 'xhigh', serviceTier: 'priority' },
  })
})

test('aiModelByProfile resolves by name and rejects unknown names', () => {
  assert({
    given: 'a known profile name',
    should: 'resolve its model',
    actual: modelId(aiModelByProfile('default-haiku-4.5').model),
    expected: 'claude-haiku-4-5',
  })

  let threw = false
  try {
    aiModelByProfile('does-not-exist')
  } catch {
    threw = true
  }
  assert({
    given: 'an unknown profile name',
    should: 'throw',
    actual: threw,
    expected: true,
  })
})
