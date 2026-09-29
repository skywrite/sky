import { inspect } from 'node:util'
import { assert, test } from '#test'
import { SensitiveValue } from './SensitiveValue.ts'

test('credential values are redacted in logs and JSON but available at an explicit use site', () => {
  const value = new SensitiveValue('mock-sensitive-value')
  assert({
    given: 'a retrieved credential',
    should: 'keep routine serialization separate from consumption',
    actual: [JSON.stringify({ value }), String(value), inspect({ value }), value.use((plain) => plain)],
    expected: ['{"value":"[redacted]"}', '[redacted]', '{ value: [redacted] }', 'mock-sensitive-value'],
  })
})
