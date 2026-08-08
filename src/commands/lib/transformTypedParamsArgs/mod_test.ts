import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { Arg, ArgOrFlag, Flag } from '../params.ts'
import transformTypedParamsArgs from './mod.ts'

test('transformTypedParamsArgs handles basic string flag', async () => {
  const params = {
    name: Flag.string('User name'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], name: 'Alice' })

  assert({
    given: 'string flag value',
    should: 'return parsed value',
    actual: result.name,
    expected: 'Alice',
  })
})

test('transformTypedParamsArgs handles number flag with coercion', async () => {
  const params = {
    count: Flag.number('Count'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], count: '42' })

  assert({
    given: 'string number flag',
    should: 'coerce to number',
    actual: result.count,
    expected: 42,
  })
})

test('transformTypedParamsArgs handles boolean flag', async () => {
  const params = {
    verbose: Flag.bool('Verbose mode'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], verbose: true })

  assert({
    given: 'boolean flag',
    should: 'return boolean value',
    actual: result.verbose,
    expected: true,
  })
})

test('transformTypedParamsArgs applies default value', async () => {
  const params = {
    count: Flag.number('Count', { default: 10 }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'] })

  assert({
    given: 'missing flag with default',
    should: 'use default value',
    actual: result.count,
    expected: 10,
  })
})

test('transformTypedParamsArgs applies async default', async () => {
  const params = {
    value: Flag.string('Value', {
      default: async () => {
        await new Promise((r) => setTimeout(r, 1))
        return 'async-default'
      },
    }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'] })

  assert({
    given: 'async default function',
    should: 'await and use result',
    actual: result.value,
    expected: 'async-default',
  })
})

test('transformTypedParamsArgs applies parse function', async () => {
  const params = {
    name: Flag.string('Name', { parse: (v) => v.toUpperCase() }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], name: 'alice' })

  assert({
    given: 'parse function',
    should: 'transform value',
    actual: result.name,
    expected: 'ALICE',
  })
})

test('transformTypedParamsArgs handles positional arg', async () => {
  const params = {
    file: Arg.string('File path'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task', '/path/to/file'] })

  assert({
    given: 'positional argument',
    should: 'extract from _ array',
    actual: result.file,
    expected: '/path/to/file',
  })
})

test('transformTypedParamsArgs handles ArgOrFlag - flag preferred', async () => {
  const params = {
    target: ArgOrFlag.string('Target', { short: 't' }),
  }

  // When both positional and flag provided, flag wins
  const result = await transformTypedParamsArgs(params, { _: ['task', 'positional'], target: 'from-flag' })

  assert({
    given: 'ArgOrFlag with both positional and flag',
    should: 'prefer flag value',
    actual: result.target,
    expected: 'from-flag',
  })
})

test('transformTypedParamsArgs handles ArgOrFlag - positional fallback', async () => {
  const params = {
    target: ArgOrFlag.string('Target'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task', 'positional-value'] })

  assert({
    given: 'ArgOrFlag with only positional',
    should: 'use positional value',
    actual: result.target,
    expected: 'positional-value',
  })
})

test('transformTypedParamsArgs handles short flag', async () => {
  const params = {
    verbose: Flag.bool('Verbose', { short: 'v' }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], v: true })

  assert({
    given: 'short flag',
    should: 'map to long name',
    actual: result.verbose,
    expected: true,
  })
})

test('transformTypedParamsArgs handles optional param without value', async () => {
  const params = {
    summary: Flag.string('Summary', { optional: true }),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'] })

  assert({
    given: 'optional param without value',
    should: 'be undefined',
    actual: result.summary,
    expected: undefined,
  })
})

test('transformTypedParamsArgs throws for missing required param', async () => {
  const params = {
    required: Flag.string('Required field', { required: true }),
  }

  let error: Error | null = null
  try {
    await transformTypedParamsArgs(params, { _: ['task'] })
  } catch (e) {
    error = e as Error
  }

  assert({
    given: 'missing required param',
    should: 'throw error',
    actual: error !== null,
    expected: true,
  })

  assert({
    given: 'missing required param',
    should: 'include param name in error',
    actual: error?.message.includes('required'),
    expected: true,
  })
})

test('transformTypedParamsArgs validates with Zod schema', async () => {
  const params = {
    count: Flag.number('Count'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], count: '5' })

  assert({
    given: 'valid value',
    should: 'pass validation',
    actual: typeof result.count,
    expected: 'number',
  })
})

test('transformTypedParamsArgs handles PlainDateTime', async () => {
  const params = {
    when: Flag.plainDateTime('When'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], when: '2026-01-15 10:30' })

  assert({
    given: 'PlainDateTime string',
    should: 'parse to PlainDateTime',
    actual: result.when instanceof PlainDateTime,
    expected: true,
  })
})

test('transformTypedParamsArgs handles kebab-case flags', async () => {
  const params = {
    maxTokens: Flag.number('Max tokens'),
  }

  const result = await transformTypedParamsArgs(params, { _: ['task'], 'max-tokens': 100 })

  assert({
    given: 'kebab-case flag',
    should: 'map to camelCase param',
    actual: result.maxTokens,
    expected: 100,
  })
})

// -----------------------------------------------------------------------------
// Unknown flag warning tests (regression for task composition)
// -----------------------------------------------------------------------------

test('transformTypedParamsArgs warns about unknown flags at compositionDepth 0', async () => {
  const params = {
    name: Flag.string('Name', { optional: true }),
  }

  // Capture console.log output
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => logs.push(args.join(' '))

  try {
    await transformTypedParamsArgs(
      params,
      { _: ['task'], name: 'Alice', unknownFlag: 'value' },
      {
        compositionDepth: 0,
      },
    )
  } finally {
    console.log = originalLog
  }

  assert({
    given: 'unknown flag at compositionDepth 0',
    should: 'log a warning',
    actual: logs.some((log) => log.includes('unknownFlag') && log.includes('not a defined flag')),
    expected: true,
  })
})

test('transformTypedParamsArgs does NOT warn about unknown flags at compositionDepth > 0', async () => {
  const params = {
    name: Flag.string('Name', { optional: true }),
  }

  // Capture console.log output
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => logs.push(args.join(' '))

  try {
    await transformTypedParamsArgs(
      params,
      { _: ['task'], name: 'Alice', unknownFlag: 'value' },
      {
        compositionDepth: 1,
      },
    )
  } finally {
    console.log = originalLog
  }

  assert({
    given: 'unknown flag at compositionDepth > 0 (task composition)',
    should: 'NOT log a warning',
    actual: logs.some((log) => log.includes('unknownFlag')),
    expected: false,
  })
})
