import { assert, test } from '#test'
import { isCommandAvailable } from './command.ts'

const fixtures = [
  { command: 'sh', expected: true, description: 'sh exists on all POSIX systems' },
  { command: 'echo', expected: true, description: 'echo is a universal command' },
  { command: 'ls', expected: true, description: 'ls exists on all POSIX systems' },
  { command: 'zzz_nonexistent_command_12345', expected: false, description: 'nonexistent command returns false' },
  { command: '', expected: false, description: 'empty string returns false' },
]

fixtures.forEach((fixture) => {
  test(`isCommandAvailable - ${fixture.description}`, async () => {
    assert({
      given: `command "${fixture.command}"`,
      should: `return ${fixture.expected}`,
      actual: await isCommandAvailable(fixture.command),
      expected: fixture.expected,
    })
  })
})
