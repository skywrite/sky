/**
 * Tests for MCP adapter schema generation
 */

import { Arg, Flag } from '#commands/mod.ts'
import type { CommandDescription } from '#commands/mod.ts'
import { assert, test } from '#test'
import { commandDescriptionToMCPSchema } from './adapter.ts'

// -- Helpers ------------------------------------------------------------------

function schemaFor(params: CommandDescription['params']) {
  return commandDescriptionToMCPSchema({ name: 'test', description: 'test', params })
}

// -- Primitive types ----------------------------------------------------------

test('adapter - string param produces type: string', () => {
  const schema = schemaFor({ name: Arg.string('User name') })
  assert({
    given: 'a string param',
    should: 'produce type string',
    actual: schema.properties.name.type,
    expected: 'string',
  })
})

test('adapter - number param produces type: number', () => {
  const schema = schemaFor({ count: Flag.number('How many', { required: true }) })
  assert({
    given: 'a number param',
    should: 'produce type number',
    actual: schema.properties.count.type,
    expected: 'number',
  })
})

test('adapter - boolean param produces type: boolean', () => {
  const schema = schemaFor({ verbose: Flag.bool('Verbose output', { default: false }) })
  assert({
    given: 'a boolean param',
    should: 'produce type boolean',
    actual: schema.properties.verbose.type,
    expected: 'boolean',
  })
})

// -- Description is preserved -------------------------------------------------

test('adapter - description is preserved on all param types', () => {
  const schema = schemaFor({ msg: Arg.string('The message to send') })
  assert({
    given: 'a param with a description',
    should: 'include the description in the schema',
    actual: schema.properties.msg.description,
    expected: 'The message to send',
  })
})

// -- Date types ---------------------------------------------------------------

test('adapter - plainDate param produces format: date with examples', () => {
  const schema = schemaFor({ date: Arg.plainDate('Target date') })
  assert({
    given: 'a plainDate param',
    should: 'have type string',
    actual: schema.properties.date.type,
    expected: 'string',
  })
  assert({
    given: 'a plainDate param',
    should: 'have format: date',
    actual: schema.properties.date.format,
    expected: 'date',
  })
  assert({
    given: 'a plainDate param',
    should: 'include examples',
    actual: Array.isArray(schema.properties.date.examples),
    expected: true,
  })
})

test('adapter - plainDateTime param produces examples with time format', () => {
  const schema = schemaFor({ when: Flag.plainDateTime('When to schedule', { required: true }) })
  assert({
    given: 'a plainDateTime param',
    should: 'have type string',
    actual: schema.properties.when.type,
    expected: 'string',
  })
  assert({
    given: 'a plainDateTime param',
    should: 'include examples with time format',
    actual: schema.properties.when.examples?.[0]?.includes(' '),
    expected: true,
  })
})

test('adapter - zonedDateTime param produces examples with timezone', () => {
  const schema = schemaFor({ at: Flag.zonedDateTime('Exact moment', { required: true }) })
  assert({
    given: 'a zonedDateTime param',
    should: 'have type string',
    actual: schema.properties.at.type,
    expected: 'string',
  })
  assert({
    given: 'a zonedDateTime param',
    should: 'include examples with timezone',
    actual: schema.properties.at.examples?.[0]?.includes(','),
    expected: true,
  })
})

// -- Hidden params ------------------------------------------------------------

test('adapter - hidden params are excluded from schema', () => {
  const schema = schemaFor({
    visible: Arg.string('Visible'),
    secret: Flag.string('Hidden', { hidden: true }),
  })
  assert({
    given: 'a hidden param',
    should: 'not appear in properties',
    actual: schema.properties.secret,
    expected: undefined,
  })
  assert({
    given: 'a visible param alongside a hidden one',
    should: 'still appear in properties',
    actual: schema.properties.visible?.type,
    expected: 'string',
  })
})

// -- Required vs optional -----------------------------------------------------

test('adapter - required args appear in required array', () => {
  const schema = schemaFor({ name: Arg.string('Name') })
  assert({
    given: 'a required arg (no optional, no default)',
    should: 'be in the required array',
    actual: schema.required?.includes('name'),
    expected: true,
  })
})

test('adapter - optional args do not appear in required array', () => {
  const schema = schemaFor({ note: Arg.string('Note', { optional: true }) })
  assert({
    given: 'an optional arg',
    should: 'not be in the required array',
    actual: schema.required?.includes('note') ?? false,
    expected: false,
  })
})

test('adapter - flags with defaults do not appear in required array', () => {
  const schema = schemaFor({ verbose: Flag.bool('Verbose', { default: false }) })
  assert({
    given: 'a flag with default',
    should: 'not be in the required array',
    actual: schema.required?.includes('verbose') ?? false,
    expected: false,
  })
})

// -- No params ----------------------------------------------------------------

test('adapter - task with no params returns empty schema', () => {
  const schema = commandDescriptionToMCPSchema({ name: 'test', description: 'test' })
  assert({
    given: 'a task with no params',
    should: 'return empty properties',
    actual: Object.keys(schema.properties).length,
    expected: 0,
  })
})
