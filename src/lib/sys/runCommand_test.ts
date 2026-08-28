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

test('runCommand - env option reaches the child', async () => {
  const result = await runCommand('printenv', ['SKY_RUNCOMMAND_TEST_VAR'], {
    env: { SKY_RUNCOMMAND_TEST_VAR: 'from-options' },
  })

  assert({
    given: 'an env entry passed via options',
    should: 'be visible to the child',
    actual: result.stdout,
    expected: 'from-options\n',
  })
})

test('runCommand - env option merges over the process env, not replaces it', async () => {
  const result = await runCommand('printenv', ['PATH'], {
    env: { SKY_RUNCOMMAND_TEST_VAR: 'x' },
  })

  assert({
    given: 'an env option alongside inherited variables',
    should: 'still expose the inherited PATH',
    actual: result.success && result.stdout.trim().length > 0,
    expected: true,
  })
})

test('runCommand - env option does not leak into the parent process', async () => {
  await runCommand('printenv', ['SKY_RUNCOMMAND_TEST_VAR'], {
    env: { SKY_RUNCOMMAND_TEST_VAR: 'x' },
  })

  assert({
    given: 'a child-only env entry',
    should: 'not appear in process.env afterwards',
    actual: process.env.SKY_RUNCOMMAND_TEST_VAR,
    expected: undefined,
  })
})

test('runCommand - a command that never starts reports why', async () => {
  const result = await runCommand('definitely-missing-binary-xyz', ['--version'])

  assert({
    given: 'a binary that is not on PATH',
    should: 'fail',
    actual: result.success,
    expected: false,
  })

  assert({
    given: 'a binary that is not on PATH',
    should: 'carry the spawn failure in stderr rather than an empty string',
    actual: result.stderr.includes('definitely-missing-binary-xyz'),
    expected: true,
  })
})
