import { assert, test } from '#test'
import type { AgentSlackUser } from './types.ts'
import parseAgentSlackUserName from './parseAgentSlackUserName.ts'
import localUser from './fixtures/agent-slack-user-local.json' with { type: 'json' }
import connectUser from './fixtures/agent-slack-user-connect.json' with { type: 'json' }

test('parseAgentSlackUserName: local user prefers real_name', () => {
  assert({
    given: 'a local workspace user with real_name, display_name, and name',
    should: 'return real_name',
    actual: parseAgentSlackUserName(localUser),
    expected: 'Jane Smith',
  })
})

test('parseAgentSlackUserName: Slack Connect user falls back to name', () => {
  assert({
    given: 'a Slack Connect user with only name (no real_name or display_name)',
    should: 'return name',
    actual: parseAgentSlackUserName(connectUser),
    expected: 'mwilson',
  })
})

test('parseAgentSlackUserName: bot user with real_name', () => {
  assert({
    given: 'a bot user with real_name',
    should: 'return real_name',
    actual: parseAgentSlackUserName({ name: 'deploy-bot', real_name: 'Deploy Bot' }),
    expected: 'Deploy Bot',
  })
})

test('parseAgentSlackUserName: display_name only', () => {
  assert({
    given: 'a user with display_name but no real_name',
    should: 'return display_name',
    actual: parseAgentSlackUserName({ name: 'rjones', display_name: 'RJ' }),
    expected: 'RJ',
  })
})

test('parseAgentSlackUserName: no name fields returns undefined', () => {
  const minimalUser: AgentSlackUser = {}
  assert({
    given: 'a user with no name fields at all',
    should: 'return undefined',
    actual: parseAgentSlackUserName(minimalUser),
    expected: undefined,
  })
})

test('parseAgentSlackUserName: empty strings are treated as falsy', () => {
  assert({
    given: 'a user with empty real_name and display_name but valid name',
    should: 'fall through to name',
    actual: parseAgentSlackUserName({ real_name: '', display_name: '', name: 'fallback' }),
    expected: 'fallback',
  })
})
