/**
 * YAML Edge Cases Test Suite
 *
 * This file documents type coercion edge cases in YAML parsing.
 * These tests verify the CURRENT behavior of npm:yaml (our YAML library).
 *
 * Key findings:
 * - npm:yaml is SAFER than js-yaml for most cases
 * - Norwegian problem (NO → false) is FIXED in npm:yaml ✅
 * - yes/no/on/off stay as strings (not coerced to booleans) ✅
 * - Only true/false get coerced to booleans
 *
 * See unified.ts parse() function documentation for full list of behaviors.
 *
 * Reference: https://news.ycombinator.com/item?id=17359376 (Norwegian problem)
 */

import { assert, test } from '#test'
import { parseWithError } from './parse.ts'

// ============================================================================
// SAFE BEHAVIORS - npm:yaml does NOT have these bugs
// ============================================================================

test('YAML Edge Case: Norwegian problem - NO stays as string (SAFE)', () => {
  const given = 'YAML with country code NO'
  const should = 'Keep NO as string (npm:yaml does NOT have this bug)'

  const yamlStr = `country: NO`
  const result = parseWithError(yamlStr)

  // Good news: npm:yaml keeps NO as 'NO' string, not false!
  // This is better than js-yaml which coerces NO → false
  // Reference: https://news.ycombinator.com/item?id=17359376
  assert({
    given,
    should: 'keep NO as string',
    expected: 'NO',
    actual: (result.data as any).country,
  })

  // Note: js-yaml with default schema would coerce this to false
  // npm:yaml is safer out of the box
})

test('YAML Edge Case: Boolean-like words stay as strings (SAFE)', () => {
  const given = 'YAML with yes/no/on/off values'
  const should = 'Keep as strings (npm:yaml is safer than js-yaml)'

  const yamlStr = `
yes_value: yes
no_value: no
on_value: on
off_value: off
true_value: true
false_value: false
`
  const result = parseWithError(yamlStr) as any

  // Good news: npm:yaml keeps yes/no/on/off as strings!
  assert({
    given: 'yes value',
    should: 'keep as string',
    expected: 'yes',
    actual: result.data.yes_value,
  })

  assert({
    given: 'no value',
    should: 'keep as string',
    expected: 'no',
    actual: result.data.no_value,
  })

  assert({
    given: 'on value',
    should: 'keep as string',
    expected: 'on',
    actual: result.data.on_value,
  })

  assert({
    given: 'off value',
    should: 'keep as string',
    expected: 'off',
    actual: result.data.off_value,
  })

  // But true/false DO get coerced to booleans
  assert({
    given: 'true value',
    should: 'coerce to boolean true',
    expected: true,
    actual: result.data.true_value,
  })

  assert({
    given: 'false value',
    should: 'coerce to boolean false',
    expected: false,
    actual: result.data.false_value,
  })

  // Note: js-yaml with default schema would coerce yes/no/on/off to booleans
  // npm:yaml is safer - only true/false are coerced
})

// ============================================================================
// TYPE COERCION BEHAVIORS - npm:yaml does coerce these
// ============================================================================

test('YAML Edge Case: Version string coerces to number', () => {
  const given = 'YAML with version number'
  const should = 'Coerce to number (loses precision)'

  const yamlStr = `version: 1.0`
  const result = parseWithError(yamlStr)

  // Current behavior: 1.0 → number
  assert({
    given,
    should: 'coerce to number',
    expected: 1.0,
    actual: (result.data as any).version,
  })

  // With failsafe schema enabled, this would be:
  // expected: '1.0' (preserves as string)
})

test('YAML Edge Case: Octal-like number treated as decimal', () => {
  const given = 'YAML with octal-like number'
  const should = 'Treat as decimal number (ignores leading zero)'

  const yamlStr = `permissions: 0777`
  const result = parseWithError(yamlStr)

  // Current behavior: 0777 → 777 (decimal, NOT octal conversion)
  // npm:yaml ignores the leading zero and treats it as decimal 777
  assert({
    given,
    should: 'treat 0777 as decimal 777 (not octal 511)',
    expected: 777,
    actual: (result.data as any).permissions,
  })

  // With failsafe schema enabled, this would be:
  // expected: '0777' (preserves as string)
  //
  // Note: js-yaml DOES convert octal 0777 → decimal 511
  // npm:yaml is different - it just strips leading zero
})

test('YAML Edge Case: Hex number coerces to decimal', () => {
  const given = 'YAML with hex number'
  const should = 'Convert hex to decimal'

  const yamlStr = `color: 0x1A`
  const result = parseWithError(yamlStr)

  // Current behavior: 0x1A → 26 (hex to decimal conversion)
  assert({
    given,
    should: 'convert hex 0x1A to decimal 26',
    expected: 26,
    actual: (result.data as any).color,
  })

  // With failsafe schema enabled, this would be:
  // expected: '0x1A' (preserves as string)
})

test('YAML Edge Case: Scientific notation coerces to number', () => {
  const given = 'YAML with scientific notation'
  const should = 'Convert to number'

  const yamlStr = `large_number: 1e3`
  const result = parseWithError(yamlStr)

  // Current behavior: 1e3 → 1000 (scientific notation to number)
  assert({
    given,
    should: 'convert 1e3 to 1000',
    expected: 1000,
    actual: (result.data as any).large_number,
  })

  // With failsafe schema enabled, this would be:
  // expected: '1e3' (preserves as string)
})

test('YAML Edge Case: Null-like words coerce to null', () => {
  const given = 'YAML with null/~ values'
  const should = 'Coerce to null'

  const yamlStr = `
null_value: null
tilde_value: ~
empty_value:
`
  const result = parseWithError(yamlStr)

  // Current behavior: null coercion
  assert({
    given: 'null value',
    should: 'coerce to null',
    expected: null,
    actual: (result.data as any).null_value,
  })

  assert({
    given: 'tilde value',
    should: 'coerce to null',
    expected: null,
    actual: (result.data as any).tilde_value,
  })

  assert({
    given: 'empty value',
    should: 'coerce to null',
    expected: null,
    actual: (result.data as any).empty_value,
  })

  // With failsafe schema enabled, these would be:
  // null_value: '', tilde_value: '', empty_value: ''
})
