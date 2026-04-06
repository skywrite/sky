/**
 * Regression: Flag.string with parse returning array was coerced back to string
 *
 * Bug: Flag.string uses z.coerce.string() by default. When a parse function
 * returned an array (e.g. val.split(',')), Zod called String(['Mood']) → "Mood".
 * Then code accessing result[0] got "M" (first char) instead of "Mood" (first element).
 *
 * Fix: Use schema: z.any() to bypass z.coerce.string() when parse returns non-string types.
 */
import { assert, test } from '#test'
import { z } from 'zod'
import transformTypedParamsArgs from '../mod.ts'
import { Flag } from '../../params.ts'

test('preserves array from parse when custom schema is used', async () => {
  const params = {
    types: Flag.string('Types', {
      parse: (val) => val.split(',').map((s) => s.trim()) as unknown as string,
      default: () => ['Mood'] as unknown as string,
      schema: z.any() as z.ZodType<string>,
    }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], types: 'Mood' })
  const types = result.types as unknown as string[]

  assert({
    given: 'parse returns array and schema is z.any()',
    should: 'preserve the array (not coerce to string)',
    actual: Array.isArray(types),
    expected: true,
  })

  assert({
    given: 'parse splits "Mood" into array',
    should: 'have "Mood" as first element, not "M"',
    actual: types[0],
    expected: 'Mood',
  })
})

test('coerces parse array to string with default schema', async () => {
  const params = {
    types: Flag.string('Types', {
      parse: (val) => val.split(',').map((s) => s.trim()) as unknown as string,
      default: () => ['Mood'] as unknown as string,
    }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], types: 'Mood' })

  assert({
    given: 'parse returns array with default z.coerce.string() schema',
    should: 'coerce array to string (this is the bug that z.any() fixes)',
    actual: typeof result.types,
    expected: 'string',
  })
})

test('parse array default value is not coerced', async () => {
  const params = {
    types: Flag.string('Types', {
      parse: (val) => val.split(',').map((s) => s.trim()) as unknown as string,
      default: () => ['Mood'] as unknown as string,
      schema: z.any() as z.ZodType<string>,
    }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'] })
  const types = result.types as unknown as string[]

  assert({
    given: 'default returns array',
    should: 'preserve array from default',
    actual: Array.isArray(types),
    expected: true,
  })

  assert({
    given: 'default array',
    should: 'have correct first element',
    actual: types[0],
    expected: 'Mood',
  })
})

test('parse comma-separated types with custom schema', async () => {
  const params = {
    types: Flag.string('Types', {
      parse: (val) => val.split(',').map((s) => s.trim()) as unknown as string,
      default: () => ['Mood'] as unknown as string,
      schema: z.any() as z.ZodType<string>,
    }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], types: 'Health,Gratitude' })
  const types = result.types as unknown as string[]

  assert({
    given: 'comma-separated types',
    should: 'split into array of two',
    actual: types.length,
    expected: 2,
  })

  assert({
    given: 'comma-separated types',
    should: 'have correct elements',
    actual: types,
    expected: ['Health', 'Gratitude'],
  })
})
