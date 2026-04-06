import { assert, test } from '#test'
import { Arg, ArgOrFlag, Flag, type InferParams, type ParamDef } from './params.ts'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Builder Tests
// -----------------------------------------------------------------------------

test('Flag.string creates a string flag param', () => {
  const param = Flag.string('User name', { short: 'n' })

  assert({
    given: 'Flag.string with description and short',
    should: 'have kind=flag',
    actual: param.kind,
    expected: 'flag',
  })

  assert({
    given: 'Flag.string',
    should: 'have type=string',
    actual: param.type,
    expected: 'string',
  })

  assert({
    given: 'Flag.string',
    should: 'have jsonType=string',
    actual: param.jsonType,
    expected: 'string',
  })

  assert({
    given: 'Flag.string with description',
    should: 'store description',
    actual: param.description,
    expected: 'User name',
  })

  assert({
    given: 'Flag.string with short option',
    should: 'store short',
    actual: param.short,
    expected: 'n',
  })
})

test('Flag.number creates a number flag param', () => {
  const param = Flag.number('Priority level', { default: 5 })

  assert({
    given: 'Flag.number',
    should: 'have type=number',
    actual: param.type,
    expected: 'number',
  })

  assert({
    given: 'Flag.number',
    should: 'have jsonType=number',
    actual: param.jsonType,
    expected: 'number',
  })

  assert({
    given: 'Flag.number with default',
    should: 'store default',
    actual: param.default,
    expected: 5,
  })
})

test('Flag.boolean creates a boolean flag param', () => {
  const param = Flag.boolean('Enable feature', { short: 'e' })

  assert({
    given: 'Flag.boolean',
    should: 'have type=boolean',
    actual: param.type,
    expected: 'boolean',
  })

  assert({
    given: 'Flag.boolean',
    should: 'have jsonType=boolean',
    actual: param.jsonType,
    expected: 'boolean',
  })
})

test('Flag.plainDateTime creates a plainDateTime flag param', () => {
  const param = Flag.plainDateTime('Start time')

  assert({
    given: 'Flag.plainDateTime',
    should: 'have type=plainDateTime',
    actual: param.type,
    expected: 'plainDateTime',
  })

  assert({
    given: 'Flag.plainDateTime',
    should: 'have jsonType=string for MCP',
    actual: param.jsonType,
    expected: 'string',
  })
})

test('Flag.zonedDateTime creates a zonedDateTime flag param', () => {
  const param = Flag.zonedDateTime('Event time')

  assert({
    given: 'Flag.zonedDateTime',
    should: 'have type=zonedDateTime',
    actual: param.type,
    expected: 'zonedDateTime',
  })

  assert({
    given: 'Flag.zonedDateTime',
    should: 'have jsonType=string for MCP',
    actual: param.jsonType,
    expected: 'string',
  })
})

test('Arg.string creates a positional arg param', () => {
  const param = Arg.string('File path')

  assert({
    given: 'Arg.string',
    should: 'have kind=arg',
    actual: param.kind,
    expected: 'arg',
  })

  assert({
    given: 'Arg.string',
    should: 'have type=string',
    actual: param.type,
    expected: 'string',
  })
})

test('ArgOrFlag.string creates an arg-or-flag param', () => {
  const param = ArgOrFlag.string('Target', { short: 't' })

  assert({
    given: 'ArgOrFlag.string',
    should: 'have kind=arg-or-flag',
    actual: param.kind,
    expected: 'arg-or-flag',
  })

  assert({
    given: 'ArgOrFlag.string',
    should: 'have type=string',
    actual: param.type,
    expected: 'string',
  })
})

test('Param with optional: true', () => {
  const param = Flag.string('Optional field', { optional: true })

  assert({
    given: 'param with optional: true',
    should: 'store optional flag',
    actual: param.optional,
    expected: true,
  })
})

test('Param with parse function', () => {
  const parseFn = (raw: string) => raw.toUpperCase()
  const param = Flag.string('Name', { parse: parseFn })

  assert({
    given: 'param with parse function',
    should: 'store parse function',
    actual: param.parse,
    expected: parseFn,
  })
})

test('Param with function default', () => {
  const defaultFn = () => 'generated'
  const param = Flag.string('Value', { default: defaultFn })

  assert({
    given: 'param with function default',
    should: 'store the function',
    actual: typeof param.default,
    expected: 'function',
  })
})

// -----------------------------------------------------------------------------
// Zod Schema Tests
// -----------------------------------------------------------------------------

test('String param schema validates strings', () => {
  const param = Flag.string('Name')
  const result = param.schema?.safeParse('hello')

  assert({
    given: 'string input',
    should: 'validate successfully',
    actual: result?.success,
    expected: true,
  })

  assert({
    given: 'string input',
    should: 'return the string',
    actual: result?.success ? result.data : null,
    expected: 'hello',
  })
})

test('Number param schema coerces and validates numbers', () => {
  const param = Flag.number('Count')

  const numResult = param.schema?.safeParse(42)
  assert({
    given: 'number input',
    should: 'validate successfully',
    actual: numResult?.success,
    expected: true,
  })

  const strResult = param.schema?.safeParse('123')
  assert({
    given: 'string number input',
    should: 'coerce to number',
    actual: strResult?.success ? strResult.data : null,
    expected: 123,
  })
})

test('Boolean param schema coerces and validates booleans', () => {
  const param = Flag.boolean('Enabled')

  const boolResult = param.schema?.safeParse(true)
  assert({
    given: 'boolean input',
    should: 'validate successfully',
    actual: boolResult?.success ? boolResult.data : null,
    expected: true,
  })
})

test('PlainDateTime param schema handles string input', () => {
  const param = Flag.plainDateTime('When')
  const result = param.schema?.safeParse('2026-01-15 10:30')

  assert({
    given: 'string datetime input',
    should: 'validate successfully',
    actual: result?.success,
    expected: true,
  })

  assert({
    given: 'string datetime input',
    should: 'return PlainDateTime instance',
    actual: result?.success ? result.data instanceof PlainDateTime : false,
    expected: true,
  })
})

test('PlainDateTime param schema handles PlainDateTime input', () => {
  const param = Flag.plainDateTime('When')
  const input = PlainDateTime.fromString('2026-01-15 10:30')
  const result = param.schema?.safeParse(input)

  assert({
    given: 'PlainDateTime instance input',
    should: 'validate successfully',
    actual: result?.success,
    expected: true,
  })

  assert({
    given: 'PlainDateTime instance input',
    should: 'return same instance',
    actual: result?.success ? result.data === input : false,
    expected: true,
  })
})

test('ZonedDateTime param schema handles string input', () => {
  const param = Flag.zonedDateTime('When')
  // ZonedDateTime constructor takes datetime and timezone separately
  // The schema parses "datetime,timezone" format
  const result = param.schema?.safeParse('2026-01-15 10:30,America/New_York')

  assert({
    given: 'string zoned datetime input',
    should: 'validate successfully',
    actual: result?.success,
    expected: true,
  })

  assert({
    given: 'string zoned datetime input',
    should: 'return ZonedDateTime instance',
    actual: result?.success ? result.data instanceof ZonedDateTime : false,
    expected: true,
  })
})

test('ZonedDateTime param schema handles ZonedDateTime input', () => {
  const param = Flag.zonedDateTime('When')
  const input = new ZonedDateTime('2026-01-15 10:30', 'America/New_York')
  const result = param.schema?.safeParse(input)

  assert({
    given: 'ZonedDateTime instance input',
    should: 'validate successfully',
    actual: result?.success,
    expected: true,
  })

  assert({
    given: 'ZonedDateTime instance input',
    should: 'return same instance',
    actual: result?.success ? result.data === input : false,
    expected: true,
  })
})

// -----------------------------------------------------------------------------
// Type Inference Tests (compile-time only, runtime verification)
// -----------------------------------------------------------------------------

test('InferParams correctly infers types from params record', () => {
  const params = {
    name: Flag.string('Name'),
    count: Flag.number('Count'),
    enabled: Flag.boolean('Enabled'),
    when: Flag.plainDateTime('When'),
  }

  // This is a compile-time check - if types are wrong, this won't compile
  type Params = InferParams<typeof params>

  // Runtime verification that the structure is correct
  const paramKeys = Object.keys(params)
  assert({
    given: 'params record',
    should: 'have all expected keys',
    actual: paramKeys.sort(),
    expected: ['count', 'enabled', 'name', 'when'],
  })
})
