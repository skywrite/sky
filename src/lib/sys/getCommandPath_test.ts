import { assert, test } from '#test'
import { getCommandPath } from './command.ts'

test('getCommandPath - returns path for existing command', async () => {
  const path = await getCommandPath('sh')

  assert({
    given: 'sh command',
    should: 'return a non-null path',
    actual: path !== null,
    expected: true,
  })

  assert({
    given: 'sh command',
    should: 'return a path containing sh',
    actual: path!.includes('sh'),
    expected: true,
  })
})

test('getCommandPath - returns absolute path', async () => {
  const path = await getCommandPath('ls')

  assert({
    given: 'ls command',
    should: 'return a path starting with /',
    actual: path!.startsWith('/'),
    expected: true,
  })
})

test('getCommandPath - returns null for nonexistent command', async () => {
  assert({
    given: 'a nonexistent command',
    should: 'return null',
    actual: await getCommandPath('zzz_nonexistent_command_12345'),
    expected: null,
  })
})
