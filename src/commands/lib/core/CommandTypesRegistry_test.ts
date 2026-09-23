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

import type { CommandTypesRegistry, InferParams } from '#commands/mod.ts'
import { Flag } from '#commands/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type CommandService from './CommandService.ts'

// -----------------------------------------------------------------------------
// Test: Declaration Merging
// -----------------------------------------------------------------------------

// Define params for a test task
const testCommandParams = {
  name: Flag.string('User name'),
  count: Flag.number('Count', { default: 10 }),
  verbose: Flag.bool('Verbose', { optional: true }),
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

/** Check the public call, including overload selection, not just its params alias. */
async function _verifyRunTypes(
  tasks: CommandService,
  dynamicName: string,
  rawArgs: Record<string, unknown>,
  knownNames: 'journal:new' | 'test:registry',
  mixedNames: 'journal:new' | 'plugin:example',
) {
  // Overrides can be omitted: defaults and inherited arguments are resolved at runtime.
  await tasks.run('journal:new')
  await tasks.run('journal:new', {})
  await tasks.run('journal:new', { types: undefined })
  await tasks.run('journal:new', { types: 'Mood, Health' })
  await tasks.run('journal:new', { types: ['Mood', 'Health'] })
  await tasks.run('markdown:sel', { server: true })
  await tasks.run('test:registry', { count: 0, verbose: false })
  await tasks.run('day:todo:move-next', { day: new PlainDate('2031-03-16') })
  await tasks.run(knownNames)

  // CLI, tool and plugin dispatchers can still supply names and arguments discovered at runtime.
  await tasks.run(dynamicName, rawArgs)
  await tasks.run('plugin:example', rawArgs)
  const pluginResult = await tasks.run<'plugin:example', { count: number }>('plugin:example', rawArgs)
  const count: number | undefined = pluginResult.data?.count
  // @ts-expect-error unregistered callers can still declare their result type
  const wrongPluginResult: string | undefined = pluginResult.data?.count

  // @ts-expect-error a registered command cannot fall back to untyped numeric input
  await tasks.run('journal:new', { types: 123 })
  // @ts-expect-error a registered command cannot fall back to untyped boolean input
  await tasks.run('journal:new', { types: true })
  // @ts-expect-error array inputs must contain strings
  await tasks.run('journal:new', { types: [123] })
  // @ts-expect-error null is not an omitted/defaulted value
  await tasks.run('journal:new', { types: null })
  // @ts-expect-error a misspelled override cannot silently use the default
  await tasks.run('journal:new', { types: ['Mood'], typse: ['Health'] })
  // @ts-expect-error declared numeric overrides must be numbers
  await tasks.run('test:registry', { count: 'many' })
  // @ts-expect-error declared boolean overrides must be booleans
  await tasks.run('test:registry', { verbose: 'yes' })
  // @ts-expect-error a date override must match its declared input type
  await tasks.run('day:todo:move-next', { day: 123 })
  // @ts-expect-error typed composition uses declared argument names
  await tasks.run('ai:context:files', { _: ['ai:context:files', 'Find Atlas notes'] })
  // @ts-expect-error known unions cannot escape to the unregistered overload
  await tasks.run(knownNames, { types: 123 })
  // @ts-expect-error adding an unregistered name must not disable checking a known command
  await tasks.run(mixedNames, { types: 123 })
  // @ts-expect-error a manually supplied result type must not bypass the registered command
  await tasks.run<{ files: string[] }>('journal:new', { types: 123 })
  // @ts-expect-error spelling out both generics cannot make a known name unregistered
  await tasks.run<'journal:new', { files: string[] }>('journal:new', { types: 123 })

  const result = await tasks.run('journal:new', { types: 'Mood' })
  const files: string[] | undefined = result.data?.files
  // @ts-expect-error the result stays inferred from the registry, not any
  const wrongResult: number[] | undefined = result.data?.files
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
