import { assert, test } from '#test'
import { runCommandJSON } from './command.ts'

const fixtures = [
  {
    args: ['{"key":"value"}'],
    expected: { key: 'value' },
    description: 'simple object',
  },
  {
    args: ['[1,2,3]'],
    expected: [1, 2, 3],
    description: 'array',
  },
  {
    args: ['{"nested":{"a":1}}'],
    expected: { nested: { a: 1 } },
    description: 'nested object',
  },
]

fixtures.forEach((fixture) => {
  test(`runCommandJSON - parses ${fixture.description}`, async () => {
    assert({
      given: `a command that outputs ${fixture.description}`,
      should: 'parse the JSON correctly',
      actual: await runCommandJSON('echo', fixture.args),
      expected: fixture.expected,
    })
  })
})

test('runCommandJSON - returns null for invalid JSON', async () => {
  const result = await runCommandJSON('echo', ['not json'])

  assert({
    given: 'a command that outputs non-JSON',
    should: 'return null',
    actual: result,
    expected: null,
  })
})

test('runCommandJSON - returns null for failed command', async () => {
  const result = await runCommandJSON('zzz_nonexistent_command_12345')

  assert({
    given: 'a nonexistent command',
    should: 'return null',
    actual: result,
    expected: null,
  })
})
