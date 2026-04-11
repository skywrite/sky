/**
 * Tests for JSON Schema generation from task param definitions
 */

import { assert, test } from '#test'
import { Arg, Flag } from '#commands/mod.ts'
import type { CommandDescription } from '#commands/mod.ts'
import { commandDescriptionToSchema, commandNameToToolName, toolNameToCommandName } from './jsonSchema.ts'

// -- Helpers ------------------------------------------------------------------

function schemaFor(params: CommandDescription['params']) {
  return commandDescriptionToSchema({ name: 'test', description: 'test', params })
}

// -- Primitive types ----------------------------------------------------------

test('jsonSchema - string param produces type: string', () => {
  const schema = schemaFor({ name: Arg.string('User name') })
  assert({
    given: 'a string param',
    should: 'produce type string',
    actual: schema.properties.name.type,
    expected: 'string',
  })
})

test('jsonSchema - number param produces type: number', () => {
  const schema = schemaFor({ count: Flag.number('How many', { required: true }) })
  assert({
    given: 'a number param',
    should: 'produce type number',
    actual: schema.properties.count.type,
    expected: 'number',
  })
})

test('jsonSchema - boolean param produces type: boolean', () => {
  const schema = schemaFor({ verbose: Flag.boolean('Verbose output', { default: false }) })
  assert({
    given: 'a boolean param',
    should: 'produce type boolean',
    actual: schema.properties.verbose.type,
    expected: 'boolean',
  })
})

// -- Description --------------------------------------------------------------

test('jsonSchema - description is preserved', () => {
  const schema = schemaFor({ msg: Arg.string('The message to send') })
  assert({
    given: 'a param with a description',
    should: 'include the description in the schema',
    actual: schema.properties.msg.description,
    expected: 'The message to send',
  })
})

// -- Date types ---------------------------------------------------------------

test('jsonSchema - plainDate produces format: date with examples', () => {
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

test('jsonSchema - plainDateTime produces examples with time', () => {
  const schema = schemaFor({ when: Flag.plainDateTime('When', { required: true }) })
  assert({
    given: 'a plainDateTime param',
    should: 'have type string',
    actual: schema.properties.when.type,
    expected: 'string',
  })
  assert({
    given: 'a plainDateTime param',
    should: 'include examples with time format',
    actual: (schema.properties.when.examples as string[])?.[0]?.includes(' '),
    expected: true,
  })
})

test('jsonSchema - zonedDateTime produces examples with timezone', () => {
  const schema = schemaFor({ at: Flag.zonedDateTime('Moment', { required: true }) })
  assert({
    given: 'a zonedDateTime param',
    should: 'have type string',
    actual: schema.properties.at.type,
    expected: 'string',
  })
  assert({
    given: 'a zonedDateTime param',
    should: 'include examples with timezone',
    actual: (schema.properties.at.examples as string[])?.[0]?.includes(','),
    expected: true,
  })
})

// -- Hidden params ------------------------------------------------------------

test('jsonSchema - hidden params are excluded', () => {
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
    should: 'still appear',
    actual: schema.properties.visible?.type,
    expected: 'string',
  })
})

// -- Required vs optional -----------------------------------------------------

test('jsonSchema - required args appear in required array', () => {
  const schema = schemaFor({ name: Arg.string('Name') })
  assert({
    given: 'a required arg',
    should: 'be in the required array',
    actual: schema.required?.includes('name'),
    expected: true,
  })
})

test('jsonSchema - optional args are not required', () => {
  const schema = schemaFor({ note: Arg.string('Note', { optional: true }) })
  assert({
    given: 'an optional arg',
    should: 'not be in the required array',
    actual: schema.required?.includes('note') ?? false,
    expected: false,
  })
})

test('jsonSchema - flags with defaults are not required', () => {
  const schema = schemaFor({ verbose: Flag.boolean('Verbose', { default: false }) })
  assert({
    given: 'a flag with default',
    should: 'not be in the required array',
    actual: schema.required?.includes('verbose') ?? false,
    expected: false,
  })
})

// -- No params ----------------------------------------------------------------

test('jsonSchema - no params returns empty schema', () => {
  const schema = commandDescriptionToSchema({ name: 'test', description: 'test' })
  assert({
    given: 'a task with no params',
    should: 'return empty properties',
    actual: Object.keys(schema.properties).length,
    expected: 0,
  })
})

// -- Name conversion ----------------------------------------------------------

test('jsonSchema - commandNameToToolName converts colons to underscores', () => {
  assert({
    given: 'a task name with colons',
    should: 'replace colons with underscores',
    actual: commandNameToToolName('slack:post'),
    expected: 'slack_post',
  })
  assert({
    given: 'a task name with multiple colons',
    should: 'replace all colons',
    actual: commandNameToToolName('ai:context:files'),
    expected: 'ai_context_files',
  })
})

test('jsonSchema - toolNameToCommandName converts first underscore to colon', () => {
  assert({
    given: 'a tool name with underscores',
    should: 'convert to colon-separated task name',
    actual: toolNameToCommandName('slack_post'),
    expected: 'slack:post',
  })
  assert({
    given: 'a tool name with no underscores',
    should: 'return as-is',
    actual: toolNameToCommandName('test'),
    expected: 'test',
  })
})
