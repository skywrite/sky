import { assert, test } from '#test'
import { PROVIDER_DEFAULTS, resolveModel, resolveProvider } from './getLanguageModel.ts'
import type { Provider } from './getLanguageModel.ts'

// ---------------------------------------------------------------------------
// resolveProvider
// ---------------------------------------------------------------------------

test('resolveProvider returns claude by default', () => {
  assert({
    given: 'no provider',
    should: 'return claude',
    actual: resolveProvider(),
    expected: 'claude',
  })
  assert({
    given: 'undefined',
    should: 'return claude',
    actual: resolveProvider(undefined),
    expected: 'claude',
  })
  assert({
    given: 'empty string',
    should: 'return claude',
    actual: resolveProvider(''),
    expected: 'claude',
  })
})

test('resolveProvider normalises case', () => {
  assert({
    given: 'OpenAI in mixed case',
    should: 'return openai',
    actual: resolveProvider('OpenAI'),
    expected: 'openai',
  })
  assert({
    given: 'CLAUDE in upper case',
    should: 'return claude',
    actual: resolveProvider('CLAUDE'),
    expected: 'claude',
  })
})

test('resolveProvider passes through known providers', () => {
  const providers: Provider[] = ['claude', 'openai', 'ollama', 'lm-studio']
  for (const p of providers) {
    assert({
      given: `provider ${p}`,
      should: `return ${p}`,
      actual: resolveProvider(p),
      expected: p,
    })
  }
})

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

test('resolveModel uses explicit model when provided', () => {
  assert({
    given: 'explicit model with claude provider',
    should: 'return the explicit model',
    actual: resolveModel('claude', 'claude-sonnet-4-6'),
    expected: 'claude-sonnet-4-6',
  })
  assert({
    given: 'explicit model with openai provider',
    should: 'return the explicit model',
    actual: resolveModel('openai', 'gpt-5.4-pro'),
    expected: 'gpt-5.4-pro',
  })
})

test('resolveModel falls back to provider default', () => {
  for (const [provider, defaultModel] of Object.entries(PROVIDER_DEFAULTS)) {
    assert({
      given: `no model for ${provider}`,
      should: `return ${defaultModel}`,
      actual: resolveModel(provider as Provider),
      expected: defaultModel,
    })
  }
})

test('resolveModel falls back to claude default for unknown provider', () => {
  assert({
    given: 'unknown provider and no model',
    should: 'return claude default',
    actual: resolveModel('unknown' as Provider),
    expected: PROVIDER_DEFAULTS.claude,
  })
})
