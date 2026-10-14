import { runCommand } from '#lib/sys/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { runProtectedSlack, SLACK_SANDBOX_PROFILE } from './protectedProcess.ts'

test('the Slack child gets credentials only in its environment and has no unrestricted fallback', async () => {
  const calls: { command: string; args: string[]; env?: Record<string, string> }[] = []
  const failed = await runProtectedSlack(
    ['auth', 'test'],
    {
      workspace: 'https://atlas.slack.com',
      token: 'xoxc-synthetic-secret',
      cookie: 'xoxd-synthetic-secret',
    },
    {},
    'darwin',
    async (command, args, options) => {
      calls.push({ command, args: args ?? [], env: options?.env })
      return { success: false, code: 1, stdout: '', stderr: 'sandbox-exec: sandbox_apply failed' }
    },
  )
  assert({
    given: 'macOS refuses the protected launch',
    should: 'make one restricted attempt with secrets absent from argv',
    actual: [
      calls.length,
      calls[0].command,
      calls[0].args.some((arg) => arg.includes('synthetic-secret')),
      calls[0].env?.SLACK_TOKEN,
      failed.success,
    ],
    expected: [1, '/usr/bin/sandbox-exec', false, 'xoxc-synthetic-secret', false],
  })
})

test(
  'macOS sandbox blocks the credential executable before it can read Keychain',
  {
    ignore: process.platform !== 'darwin' || env.get('SKY_SLACK_SANDBOX_TESTS') !== '1',
  },
  async () => {
    // Help reads no credentials even if the profile regresses. Never lock or query a real keychain in tests.
    const result = await runCommand('/usr/bin/sandbox-exec', [
      '-p',
      SLACK_SANDBOX_PROFILE,
      '/bin/sh',
      '-c',
      '/usr/bin/security help unlock-keychain',
    ])
    assert({
      given: 'a child tries to invoke the system credential tool',
      should: 'deny execution before any authentication request',
      actual: [result.success, /security: Operation not permitted/.test(result.stderr)],
      expected: [false, true],
    })
  },
)
