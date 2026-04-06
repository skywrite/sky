/**
 * YAML Unified Module Tests
 *
 * Tests for basic YAML parsing and error handling.
 * For YAML edge case tests (Norwegian problem, type coercion, etc.),
 * see edgecases_test.ts
 */

import { assert, test } from '#test'
import { parseWithError } from './parse.ts'

test('parseWithError() - valid YAML', () => {
  const given = 'Valid YAML string'
  const should = 'Parse successfully without error'

  const yamlStr = `
name: John Doe
age: 30
tags: one, two, three
`

  const result = parseWithError(yamlStr)

  assert({
    given,
    should: 'return parsed data',
    expected: {
      name: 'John Doe',
      age: 30,
      tags: 'one, two, three',
    },
    actual: result.data,
  })

  assert({
    given,
    should: 'have no error',
    expected: undefined,
    actual: result.error,
  })
})

test('parseWithError() - empty string', () => {
  const given = 'Empty string'
  const should = 'Return empty object without error'

  const result = parseWithError('')

  assert({
    given,
    should: 'return empty object',
    expected: {},
    actual: result.data,
  })

  assert({
    given,
    should: 'have no error',
    expected: undefined,
    actual: result.error,
  })
})

test('parseWithError() - whitespace only', () => {
  const given = 'Whitespace only string'
  const should = 'Return empty object without error'

  const result = parseWithError('   \n  \t  ')

  assert({
    given,
    should: 'return empty object',
    expected: {},
    actual: result.data,
  })

  assert({
    given,
    should: 'have no error',
    expected: undefined,
    actual: result.error,
  })
})

test('parseWithError() - invalid YAML with unquoted colon', () => {
  const given = 'YAML with unquoted colon in value'
  const should = 'Return empty object with error message'

  const yamlStr = `summary: AI Tool Exploration: Comet Browser`

  const result = parseWithError(yamlStr)

  assert({
    given,
    should: 'return empty object',
    expected: {},
    actual: result.data,
  })

  assert({
    given,
    should: 'have error message',
    expected: true,
    actual: result.error !== undefined,
  })

  assert({
    given,
    should: 'error message contains "Nested mappings"',
    expected: true,
    actual: result.error?.includes('Nested mappings') || false,
  })
})

test('parseWithError() - invalid YAML with bad indentation', () => {
  const given = 'YAML with bad indentation'
  const should = 'Parse successfully (YAML library is lenient with this case)'

  const yamlStr = `
parent:
child: value
`

  const result = parseWithError(yamlStr)

  // The YAML library actually parses this as valid (parent: null, child: value)
  assert({
    given,
    should: 'return parsed data',
    expected: {
      parent: null,
      child: 'value',
    },
    actual: result.data,
  })

  assert({
    given,
    should: 'have no error',
    expected: undefined,
    actual: result.error,
  })
})

test('parseWithError() - invalid YAML with duplicate keys', () => {
  const given = 'YAML with duplicate keys'
  const should = 'Return empty object with error (YAML library rejects duplicates)'

  const yamlStr = `
name: John
name: Jane
age: 30
`

  const result = parseWithError(yamlStr)

  // The YAML library we're using rejects duplicate keys
  assert({
    given,
    should: 'return empty object due to error',
    expected: {},
    actual: result.data,
  })

  assert({
    given,
    should: 'have error message about duplicate keys',
    expected: true,
    actual: result.error !== undefined && result.error.includes('Map keys must be unique'),
  })
})

test('parseWithError() - complex valid YAML', () => {
  const given = 'Complex nested YAML structure'
  const should = 'Parse successfully without error'

  const yamlStr = `
person:
  name: John Doe
  age: 30
  addresses:
    - type: home
      city: New York
    - type: work
      city: Boston
tags:
  - javascript
  - typescript
metadata:
  created: 2024-01-01
  updated: 2024-01-02
`

  const result = parseWithError(yamlStr)

  assert({
    given,
    should: 'parse complex structure',
    expected: true,
    actual: result.data !== undefined && !result.error,
  })

  assert({
    given,
    should: 'have correct nested structure',
    expected: 'John Doe',
    actual: (result.data as any)?.person?.name,
  })

  assert({
    given,
    should: 'have correct array',
    expected: 2,
    actual: (result.data as any)?.person?.addresses?.length,
  })
})

test('parseWithError() - null and undefined handling', () => {
  const given = 'null input'
  const should = 'Return empty object without error'

  const resultNull = parseWithError(null as any)
  const resultUndefined = parseWithError(undefined as any)

  assert({
    given: 'null input',
    should: 'return empty object',
    expected: {},
    actual: resultNull.data,
  })

  assert({
    given: 'undefined input',
    should: 'return empty object',
    expected: {},
    actual: resultUndefined.data,
  })

  assert({
    given: 'null input',
    should: 'have no error',
    expected: undefined,
    actual: resultNull.error,
  })

  assert({
    given: 'undefined input',
    should: 'have no error',
    expected: undefined,
    actual: resultUndefined.error,
  })
})
