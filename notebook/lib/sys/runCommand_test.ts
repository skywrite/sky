import { assert, test } from '#test'
import { runCommand } from './command.ts'

test('runCommand - successful command returns stdout', async () => {
  const result = await runCommand('echo', ['hello world'])

  assert({
    given: 'echo hello world',
    should: 'succeed',
    actual: result.success,
    expected: true,
  })

  assert({
    given: 'echo hello world',
    should: 'return stdout with trailing newline',
    actual: result.stdout,
    expected: 'hello world\n',
  })

  assert({
    given: 'echo hello world',
    should: 'return exit code 0',
    actual: result.code,
    expected: 0,
  })
})

test('runCommand - no args defaults to empty', async () => {
  const result = await runCommand('echo')

  assert({
    given: 'echo with no args',
    should: 'succeed',
    actual: result.success,
    expected: true,
  })
})

test('runCommand - failed command returns error info', async () => {
  const result = await runCommand('sh', ['-c', 'exit 42'])

  assert({
    given: 'a command that exits with code 42',
    should: 'not succeed',
    actual: result.success,
    expected: false,
  })
})

test('runCommand - nonexistent command returns failure', async () => {
  const result = await runCommand('zzz_nonexistent_command_12345')

  assert({
    given: 'a nonexistent command',
    should: 'not succeed',
    actual: result.success,
    expected: false,
  })
})

test('runCommand - captures stderr', async () => {
  const result = await runCommand('sh', ['-c', 'echo oops >&2; exit 1'])

  assert({
    given: 'a command that writes to stderr',
    should: 'capture stderr',
    actual: result.stderr.includes('oops'),
    expected: true,
  })

  assert({
    given: 'a command that writes to stderr',
    should: 'not succeed',
    actual: result.success,
    expected: false,
  })
})

test('runCommand - stdout and stderr are independent', async () => {
  const result = await runCommand('sh', ['-c', 'echo out; echo err >&2'])

  assert({
    given: 'a command writing to both stdout and stderr',
    should: 'capture stdout',
    actual: result.stdout.includes('out'),
    expected: true,
  })

  assert({
    given: 'a command writing to both stdout and stderr',
    should: 'capture stderr',
    actual: result.stderr.includes('err'),
    expected: true,
  })
})

test('runCommand - handles multi-line output', async () => {
  const result = await runCommand('sh', ['-c', 'echo line1; echo line2; echo line3'])

  assert({
    given: 'a command with multi-line output',
    should: 'capture all lines',
    actual: result.stdout,
    expected: 'line1\nline2\nline3\n',
  })
})
