import { assert, test } from '#test'
import { parseAuthTest, parseWhoami } from './auth.ts'

const okJson = JSON.stringify(
  {
    ok: true,
    url: 'https://atlas.slack.com/',
    team: 'Atlas Corp',
    user: 'jane',
    team_id: 'T01234567',
    user_id: 'U01234567',
  },
  null,
  2,
)

test('parseAuthTest: valid credentials', () => {
  assert({
    given: 'auth test success JSON with extra fields',
    should: 'return ok with url, team, and user',
    actual: parseAuthTest(okJson, ''),
    expected: { ok: true, url: 'https://atlas.slack.com/', team: 'Atlas Corp', user: 'jane' },
  })
})

test('parseAuthTest: stale credentials print a bare error line', () => {
  assert({
    given: 'invalid_auth on stdout',
    should: 'return not-ok with the error string',
    actual: parseAuthTest('invalid_auth\n', ''),
    expected: { ok: false, error: 'invalid_auth' },
  })
})

test('parseAuthTest: error on stderr only', () => {
  assert({
    given: 'empty stdout and an error on stderr',
    should: 'fall back to stderr',
    actual: parseAuthTest('', 'no workspaces configured\n'),
    expected: { ok: false, error: 'no workspaces configured' },
  })
})

test('parseAuthTest: JSON with ok false', () => {
  assert({
    given: 'a JSON body reporting ok: false with an error field',
    should: 'return not-ok with that error',
    actual: parseAuthTest('{"ok": false, "error": "invalid_auth"}', ''),
    expected: { ok: false, error: 'invalid_auth' },
  })
})

test('parseAuthTest: no output at all', () => {
  assert({
    given: 'empty stdout and stderr',
    should: 'return unknown_error',
    actual: parseAuthTest('', ''),
    expected: { ok: false, error: 'unknown_error' },
  })
})

const whoamiJson = JSON.stringify({
  version: 1,
  updated_at: '2026-01-01T00:00:00.000Z',
  default_workspace_url: 'https://atlas.slack.com',
  workspaces: [
    { workspace_url: 'https://atlas.slack.com', workspace_name: 'Atlas Corp', auth_type: 'browser' },
    { workspace_url: 'https://atlas-guilds.slack.com', workspace_name: 'Atlas Guilds', auth_type: 'browser' },
  ],
})

test('parseWhoami: default workspace and list', () => {
  assert({
    given: 'whoami JSON with a default and two workspaces',
    should: 'return the default URL and all workspace URLs',
    actual: parseWhoami(whoamiJson),
    expected: {
      defaultWorkspaceUrl: 'https://atlas.slack.com',
      workspaceUrls: ['https://atlas.slack.com', 'https://atlas-guilds.slack.com'],
    },
  })
})

test('parseWhoami: no default workspace', () => {
  assert({
    given: 'whoami JSON without default_workspace_url',
    should: 'return undefined default and the workspace list',
    actual: parseWhoami('{"workspaces": [{"workspace_url": "https://atlas.slack.com"}]}'),
    expected: { defaultWorkspaceUrl: undefined, workspaceUrls: ['https://atlas.slack.com'] },
  })
})

test('parseWhoami: non-JSON output', () => {
  assert({
    given: 'garbage output',
    should: 'return undefined',
    actual: parseWhoami('command not found'),
    expected: undefined,
  })
})
