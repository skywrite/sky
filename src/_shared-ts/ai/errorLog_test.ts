import { assert, test } from '#test'
import type { Warning } from 'ai'
import { formatAIWarning, routeAISDKWarningsToLog } from './errorLog.ts'

test('formatAIWarning renders an "other" warning as its bare message', () => {
  assert({
    given: 'an other-type warning',
    should: 'return the message verbatim',
    actual: formatAIWarning({ type: 'other', message: 'unsupported reasoning metadata' }),
    expected: 'unsupported reasoning metadata',
  })
})

test('formatAIWarning renders an unsupported-feature warning with details', () => {
  assert({
    given: 'an unsupported warning with details',
    should: 'name the feature and append the details',
    actual: formatAIWarning({ type: 'unsupported', feature: 'temperature', details: 'ignored with thinking' }),
    expected: 'unsupported feature "temperature": ignored with thinking',
  })
})

test('formatAIWarning renders a deprecated warning', () => {
  assert({
    given: 'a deprecated warning',
    should: 'name the setting and include the message',
    actual: formatAIWarning({ type: 'deprecated', setting: 'maxTokens', message: 'use maxOutputTokens' }),
    expected: 'deprecated "maxTokens": use maxOutputTokens',
  })
})

test('formatAIWarning falls back to JSON for unknown warning kinds', () => {
  const future = { type: 'future-kind', extra: 1 } as unknown as Warning
  assert({
    given: 'a warning type this code does not know',
    should: 'serialize it instead of dropping it',
    actual: formatAIWarning(future),
    expected: '{"type":"future-kind","extra":1}',
  })
})

test('routeAISDKWarningsToLog installs the global logger', () => {
  const previous = globalThis.AI_SDK_LOG_WARNINGS
  try {
    routeAISDKWarningsToLog()
    assert({
      given: 'the router has been installed',
      should: 'replace the AI SDK default warning logger',
      actual: typeof globalThis.AI_SDK_LOG_WARNINGS,
      expected: 'function',
    })
  } finally {
    globalThis.AI_SDK_LOG_WARNINGS = previous
  }
})
