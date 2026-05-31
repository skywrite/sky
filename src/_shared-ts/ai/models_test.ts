import { assert, test } from '#test'
import { aiModel, aiModelByProfile, defineProfile, resolveProfile, type ResolvedModel } from './models.ts'

function modelId(m: ResolvedModel['model']): string {
  return (m as { modelId: string }).modelId
}

test('aiModel resolves a role to its baseline profile model', () => {
  assert({
    given: 'the reasoning role',
    should: 'resolve to the opus-4-6 profile model',
    actual: modelId(aiModel('reasoning').model),
    expected: 'claude-opus-4-6',
  })
  assert({
    given: 'the fast role',
    should: 'resolve to the haiku-4-5 profile model',
    actual: modelId(aiModel('fast').model),
    expected: 'claude-haiku-4-5',
  })
  assert({
    given: 'the balanced role',
    should: 'resolve to the sonnet-4-6 profile model',
    actual: modelId(aiModel('balanced').model),
    expected: 'claude-sonnet-4-6',
  })
  assert({
    given: 'the vision role',
    should: 'resolve to the openai gpt-4o profile model',
    actual: modelId(aiModel('vision').model),
    expected: 'gpt-4o',
  })
})

test('option-less baseline profiles carry no providerOptions', () => {
  assert({
    given: 'a baseline profile with no options',
    should: 'omit providerOptions (behaviour-preserving)',
    actual: aiModel('reasoning').providerOptions,
    expected: undefined,
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

test('aiModelByProfile resolves by name and rejects unknown names', () => {
  assert({
    given: 'a known profile name',
    should: 'resolve its model',
    actual: modelId(aiModelByProfile('haiku-4-5').model),
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
