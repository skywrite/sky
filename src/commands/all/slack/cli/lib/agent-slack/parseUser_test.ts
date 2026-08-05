import { assert, test } from '#test'
import connectUser from './fixtures/agent-slack-user-connect.json' with { type: 'json' }
import localUser from './fixtures/agent-slack-user-local.json' with { type: 'json' }
import parseUser from './parseUser.ts'
import type { AgentSlackUser } from './types.ts'

test('parseUser: local user prefers real_name', () => {
  assert({
    given: 'a local workspace user with real_name, display_name, and name',
    should: 'return real_name',
    actual: parseUser(localUser),
    expected: 'Jane Smith',
  })
})

test('parseUser: Slack Connect user falls back to name', () => {
  assert({
    given: 'a Slack Connect user with only name (no real_name or display_name)',
    should: 'return name',
    actual: parseUser(connectUser),
    expected: 'mwilson',
  })
})

test('parseUser: bot user with real_name', () => {
  assert({
    given: 'a bot user with real_name',
    should: 'return real_name',
    actual: parseUser({ name: 'deploy-bot', real_name: 'Deploy Bot' }),
    expected: 'Deploy Bot',
  })
})

test('parseUser: display_name only', () => {
  assert({
    given: 'a user with display_name but no real_name',
    should: 'return display_name',
    actual: parseUser({ name: 'rjones', display_name: 'RJ' }),
    expected: 'RJ',
  })
})

test('parseUser: no name fields returns undefined', () => {
  const minimalUser: AgentSlackUser = {}
  assert({
    given: 'a user with no name fields at all',
    should: 'return undefined',
    actual: parseUser(minimalUser),
    expected: undefined,
  })
})

test('parseUser: empty strings are treated as falsy', () => {
  assert({
    given: 'a user with empty real_name and display_name but valid name',
    should: 'fall through to name',
    actual: parseUser({ real_name: '', display_name: '', name: 'fallback' }),
    expected: 'fallback',
  })
})
