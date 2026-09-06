import { loadOAuthClient, serializeStoredTokens } from '#lib/google/mod.ts'
import { createLogin, createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import type { SecretEntry } from '#lib/secrets/types.ts'
import { assert, test } from '#test'
import { type ConnectionsData, type ConnectionsHost, createConnectionsRoutes, type SlackStatus } from './connections.ts'

// The routes over a store in memory: the keychain is never touched here.

const GMAIL = 'https://www.googleapis.com/auth/gmail.modify'
const CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'
const DRIVE = 'https://www.googleapis.com/auth/drive'

/** Stored values — none may ever appear whole in an answer. */
const VALUES = {
  client: 'shh-client-secret',
  tokens: 'rt-refresh-secret',
  cerebras: 'csk-cerebras-4f2a',
  mail: 'pw-mail-secret',
  notion: 'ntn-notion-9c1e',
  pin: '1234',
}

function seeded(): Record<string, SecretEntry> {
  return {
    'google/client': createLogin({ user: 'id-123.apps', pass: VALUES.client }),
    'google/jane@example.com': createSecret(
      serializeStoredTokens({ refreshToken: VALUES.tokens, scopes: [GMAIL, CALENDAR, DRIVE] }),
    ),
    'cerebras/main': createSecret(VALUES.cerebras),
    'email/personal': createLogin({ user: 'jane@example.com', pass: VALUES.mail }),
    'notion/main': createSecret(VALUES.notion),
    'pin/main': createSecret(VALUES.pin),
  }
}

const CONNECTED: SlackStatus = {
  installed: true,
  ok: true,
  workspace: 'https://atlas.slack.com',
  team: 'Atlas',
  user: 'jane',
}

const SIGN_IN = { id: 'c1', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' }

function hostWith(seed: Record<string, SecretEntry> = seeded()) {
  const secrets = new TestSecretsProvider(seed)
  const slackCalls: string[] = []
  let signIn: { id: string; url: string } | null = SIGN_IN
  const host: ConnectionsHost = {
    secrets,
    providers: () => [
      { id: 'anthropic', label: 'Anthropic' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'cerebras', label: 'Cerebras' },
    ],
    google: {
      connect: () => Promise.resolve(signIn),
      connection: (id) => (id === SIGN_IN.id ? { status: 'waiting' } : null),
    },
    slack: {
      status: () => {
        slackCalls.push('status')
        return Promise.resolve(CONNECTED)
      },
      reconnect: () => {
        slackCalls.push('reconnect')
        return Promise.resolve(CONNECTED)
      },
    },
  }
  const app = createConnectionsRoutes(host)
  const withoutClient = () => {
    signIn = null
  }
  return { app, secrets, slackCalls, withoutClient }
}

type App = ReturnType<typeof hostWith>['app']

function post(app: App, url: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  )
}

function del(app: App, url: string): Promise<Response> {
  return Promise.resolve(app.request(url, { method: 'DELETE' }))
}

test({ name: 'connections route - the payload is presence, never a value' }, async () => {
  const { app } = hostWith()
  const response = await app.request('/')
  const text = await response.text()
  const data = JSON.parse(text) as ConnectionsData

  assert({
    given: 'a keychain with the Google client and one account',
    should: 'answer the client as present and the account with its grants',
    actual: [response.status, data.google.client, data.google.accounts],
    expected: [200, true, [{ email: 'jane@example.com', grants: ['Mail', 'Calendar', 'Drive'] }]],
  })
  assert({
    given: 'the rest of the keychain',
    should:
      'list every entry but the Google ones — a provider key named after its provider, the filler name never printed, a login with its username, a long key by its tail and a short one without',
    actual: data.secrets,
    expected: [
      { category: 'cerebras', name: 'main', type: 'secret', label: 'Cerebras API key', sub: '', tail: '4f2a' },
      {
        category: 'email',
        name: 'personal',
        type: 'login',
        label: 'email · personal',
        sub: 'Login · jane@example.com',
      },
      { category: 'notion', name: 'main', type: 'secret', label: 'notion', sub: 'Secret', tail: '9c1e' },
      { category: 'pin', name: 'main', type: 'secret', label: 'pin', sub: 'Secret' },
    ],
  })
  assert({
    given: 'the whole answer',
    should: 'carry none of the stored values whole',
    actual: Object.values(VALUES).filter((value) => text.includes(value)),
    expected: [],
  })
  assert({
    given: 'the payload',
    should: 'carry the Google Cloud steps for the client form',
    actual: data.google.setup.length > 0,
    expected: true,
  })
})

test({ name: 'connections route - set stores a secret or a login, keeping an entry’s history' }, async () => {
  const { app, secrets } = hostWith()
  const before = await secrets.get('cerebras', 'main')

  const key = await post(app, '/secret', { category: 'openai', type: 'secret', value: ' sk-new ' })
  const rotated = await post(app, '/secret', {
    category: 'cerebras',
    name: 'main',
    type: 'secret',
    value: 'csk-rotated',
  })
  const login = await post(app, '/secret', {
    category: 'email',
    name: 'work',
    type: 'login',
    user: 'jane@work.example',
    pass: 'pw',
  })
  const retyped = await post(app, '/secret', {
    category: 'email',
    name: 'personal',
    type: 'secret',
    value: 'now-a-token',
  })

  const stored = await secrets.get('openai', 'main')
  const after = await secrets.get('cerebras', 'main')
  const work = await secrets.get('email', 'work')
  const personal = await secrets.get('email', 'personal')
  assert({
    given: 'a new key with no name, a rotated key, a new login, and a login re-set as a secret',
    should:
      'store each — the blank name filled, the value trimmed, the rotation keeping its created date, the retype starting fresh',
    actual: [
      key.status,
      rotated.status,
      login.status,
      retyped.status,
      stored?.type === 'secret' && stored.val,
      after?.type === 'secret' && [after.val, after.created === before?.created],
      work?.type === 'login' && work.user,
      personal?.type,
    ],
    expected: [200, 200, 200, 200, 'sk-new', ['csk-rotated', true], 'jane@work.example', 'secret'],
  })

  const badCategory = await post(app, '/secret', { category: 'my cat', name: 'x', type: 'secret', value: 'v' })
  const badName = await post(app, '/secret', { category: 'a', name: 'a b', type: 'secret', value: 'v' })
  const badType = await post(app, '/secret', { category: 'a', name: 'b', type: 'note', value: 'v' })
  const noValue = await post(app, '/secret', { category: 'a', name: 'b', type: 'secret', value: '  ' })
  const noPass = await post(app, '/secret', { category: 'a', name: 'b', type: 'login', user: 'u' })
  assert({
    given: 'a spaced category, a spaced name, an unknown type, a blank value, a login without a password',
    should: 'refuse each with 400 and store nothing more',
    actual: [
      badCategory.status,
      badName.status,
      badType.status,
      noValue.status,
      noPass.status,
      (await secrets.list()).length,
    ],
    expected: [400, 400, 400, 400, 400, 8],
  })
  assert({
    given: 'validation failures returned to the keychain form',
    should: 'identify the exact field to highlight without returning the submitted secret',
    actual: await Promise.all(
      [badCategory, badName, badType, noValue, noPass].map(async (response) => {
        const body = (await response.json()) as { field: string; message: string }
        return { field: body.field, message: Boolean(body.message) }
      }),
    ),
    expected: ['category', 'name', 'type', 'value', 'pass'].map((field) => ({ field, message: true })),
  })
})

test({ name: 'connections route - delete removes one entry and says when there is none' }, async () => {
  const { app, secrets } = hostWith()

  const gone = await del(app, '/secret/notion/main')
  const account = await del(app, '/secret/google/jane%40example.com')
  const unknown = await del(app, '/secret/nope/x')
  const data = (await (await app.request('/')).json()) as ConnectionsData
  assert({
    given: 'a delete of a secret, of a Google account, and of a name never stored',
    should: 'remove the first two and 404 the third',
    actual: [
      gone.status,
      account.status,
      unknown.status,
      await secrets.get('notion', 'main'),
      data.google.accounts,
      data.secrets.map((row) => `${row.category}/${row.name}`),
    ],
    expected: [200, 200, 404, null, [], ['cerebras/main', 'email/personal', 'pin/main']],
  })
})

test({ name: 'connections route - the Google client is saved, then a sign-in can start' }, async () => {
  const { app, secrets, withoutClient } = hostWith({})

  const bad = await post(app, '/google/client', { clientId: 'id' })
  const saved = await post(app, '/google/client', { clientId: ' id-1 ', clientSecret: 'sec' })
  const client = await loadOAuthClient(secrets)
  const started = await post(app, '/google/connect', {})
  const waiting = await app.request('/google/connect/c1')
  const unknown = await app.request('/google/connect/zzz')
  withoutClient()
  const refused = await post(app, '/google/connect', {})
  assert({
    given: 'a half client, a whole one, a sign-in, its state, a stranger, and a sign-in with no client',
    should:
      'refuse the half, store the whole, hand out the URL and id, answer the state, 404 the stranger, 409 the last',
    actual: [
      bad.status,
      saved.status,
      client,
      started.status,
      await started.json(),
      waiting.status,
      await waiting.json(),
      unknown.status,
      refused.status,
    ],
    expected: [400, 200, { clientId: 'id-1', clientSecret: 'sec' }, 200, SIGN_IN, 200, { status: 'waiting' }, 404, 409],
  })
})

test({ name: 'connections route - Slack is asked, and re-imported on request' }, async () => {
  const { app, slackCalls } = hostWith()
  const status = await app.request('/slack')
  const again = await post(app, '/slack/reconnect', {})
  assert({
    given: 'a status read and a reconnect',
    should: 'pass each to the host and answer what it said',
    actual: [status.status, await status.json(), again.status, slackCalls],
    expected: [200, CONNECTED, 200, ['status', 'reconnect']],
  })
})
