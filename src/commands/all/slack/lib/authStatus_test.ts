import { assert, test } from '#test'
import { slackProfileName } from './authStatus.ts'

test('Slack connection resolves the authenticated user in the checked workspace', async () => {
  const calls: string[][] = []
  const name = await slackProfileName('U01234567', 'https://atlas.slack.com/', async (args) => {
    calls.push(args)
    return {
      success: true,
      stdout: JSON.stringify({ id: 'U01234567', name: 'account-alias', display_name: 'JD', real_name: 'Jane Doe' }),
    }
  })
  assert({
    given: 'a profile with a preferred display name and a different account handle',
    should: 'use the live display name from the exact authenticated user and workspace',
    actual: { name, calls },
    expected: { name: 'JD', calls: [['user', 'get', 'U01234567', '--workspace', 'https://atlas.slack.com/']] },
  })
})

test('Slack connection falls back to the real name without presenting an account alias as a profile name', async () => {
  for (const [profile, expected] of [
    [{ display_name: ' Jane ', real_name: 'Jane Doe' }, 'Jane'],
    [{ display_name: ' ', real_name: ' Jane Doe ' }, 'Jane Doe'],
    [{ name: 'account-alias' }, undefined],
    [{ id: 'U99999999', display_name: 'Someone Else' }, undefined],
  ] as const) {
    assert({
      given: 'a profile with missing, blank, or mismatched identity fields',
      should: 'return only the authenticated person’s display or real name',
      actual: await slackProfileName('U01234567', 'https://atlas.slack.com/', async () => ({
        success: true,
        stdout: JSON.stringify({ id: 'U01234567', ...profile }),
      })),
      expected,
    })
  }
})

test('Slack profile lookup failures do not turn a successful connection test into an authentication error', async () => {
  for (const result of [
    { success: false, stdout: 'missing_scope' },
    { success: true, stdout: 'not JSON' },
    { success: true, stdout: 'null' },
    null,
  ]) {
    assert({
      given: 'an unsuccessful, malformed, or rejected profile lookup',
      should: 'leave the profile name unavailable without throwing',
      actual: await slackProfileName('U01234567', 'https://atlas.slack.com/', async () => {
        if (!result) throw new Error('Network unavailable')
        return result
      }),
      expected: undefined,
    })
  }
})
