/**
 * Tests for CommandTypesRegistry type inference.
 *
 * These tests verify that:
 * 1. Declaration merging works to extend the registry
 * 2. Type inference correctly resolves params and result types
 * 3. Unregistered tasks still work with loose typing
 *
 * Most of the value here is compile-time type checking.
 * If these tests compile, the types are working correctly.
 */

import { assert, test } from '#test'
import type { CommandTypesRegistry, InferParams } from '#commands/mod.ts'
import { Flag } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Test: Declaration Merging
// -----------------------------------------------------------------------------

// Define params for a test task
const testCommandParams = {
  name: Flag.string('User name'),
  count: Flag.number('Count', { default: 10 }),
  verbose: Flag.boolean('Verbose', { optional: true }),
}

// Result type for the test task
type TestCommandResult = {
  processed: number
  message: string
}

// Augment the registry via declaration merging
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'test:registry': {
      params: InferParams<typeof testCommandParams>
      result: TestCommandResult
    }
  }
}

// -----------------------------------------------------------------------------
// Compile-time Type Tests
// -----------------------------------------------------------------------------

// These functions exist purely to verify type inference at compile time.
// If they compile, the types are correct.

/** Verify that registered task params are correctly typed */
function _verifyParamsType(): CommandTypesRegistry['test:registry']['params'] {
  // This should compile without errors
  return {
    name: 'test',
    count: 5,
    verbose: true,
  }
}

/** Verify that registered task result is correctly typed */
function _verifyResultType(): CommandTypesRegistry['test:registry']['result'] {
  // This should compile without errors
  return {
    processed: 10,
    message: 'done',
  }
}

// -----------------------------------------------------------------------------
// Runtime Tests
// -----------------------------------------------------------------------------

test('CommandTypesRegistry can be augmented via declaration merging', () => {
  // This test verifies that the declaration merging worked
  // by checking that we can create valid values for the registered types

  const params: CommandTypesRegistry['test:registry']['params'] = {
    name: 'test-user',
    count: 42,
    verbose: false,
  }

  assert({
    given: 'params matching registered type',
    should: 'have correct name field',
    actual: params.name,
    expected: 'test-user',
  })

  assert({
    given: 'params matching registered type',
    should: 'have correct count field',
    actual: params.count,
    expected: 42,
  })
})

test('CommandTypesRegistry result type is correctly inferred', () => {
  const result: CommandTypesRegistry['test:registry']['result'] = {
    processed: 100,
    message: 'All done',
  }

  assert({
    given: 'result matching registered type',
    should: 'have correct processed field',
    actual: result.processed,
    expected: 100,
  })

  assert({
    given: 'result matching registered type',
    should: 'have correct message field',
    actual: result.message,
    expected: 'All done',
  })
})

test('InferParams correctly infers types from params definition', () => {
  type Inferred = InferParams<typeof testCommandParams>

  // Create a value that matches the inferred type
  const value: Inferred = {
    name: 'inferred',
    count: 99,
    verbose: undefined,
  }

  assert({
    given: 'value matching InferParams type',
    should: 'have string name',
    actual: typeof value.name,
    expected: 'string',
  })

  assert({
    given: 'value matching InferParams type',
    should: 'have number count',
    actual: typeof value.count,
    expected: 'number',
  })
})
