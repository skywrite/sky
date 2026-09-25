import { loadOAuthClient, serializeStoredTokens } from '#lib/google/mod.ts'
import { KeychainAccessError } from '#lib/secrets/keychainProtocol.ts'
import { createLogin, createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import type { SecretEntry } from '#lib/secrets/types.ts'
import { assert, test } from '#test'
import {
  type BeeperStatus,
  type ConnectionsData,
  type ConnectionsHost,
  createConnectionsRoutes,
  type SlackStatus,
  type TypeSafeStatus,
} from './connections.ts'

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
  beeper: 'bpr-token-secret-4f2a',
  typesafe: 'tsk-typesafe-key-9d2e',
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
    'typesafe/main': createSecret(VALUES.typesafe),
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

const BEEPER: BeeperStatus = {
  running: true,
  version: '4.3.0',
  connected: true,
  accounts: [
    {
      id: 'wa1',
      network: 'WhatsApp',
      status: 'connected',
      save: true,
      groups: true,
      holdUnknown: false,
      chosen: true,
      chats: 4,
    },
    {
      id: 'sg1',
      network: 'Signal',
      status: 'connected',
      save: false,
      groups: false,
      holdUnknown: true,
      chosen: false,
      chats: 0,
    },
  ],
  held: [
    {
      chat: '!held1',
      network: 'WhatsApp',
      who: '+1 (555) 010-2277',
      first: 'Reply STOP to end.',
      at: '2026-03-11T09:00:00Z',
      count: 2,
    },
  ],
  lastRun: {
    at: '2026-03-11T13:00:00Z',
    chats: 2,
    messages: 3,
    files: 2,
    skipped: [{ chat: 'Atlas launch team', reason: 'groups are off for WhatsApp' }],
    accountsOff: ['Signal'],
    complete: true,
  },
}
const BEEPER_PREVIEW = {
  rows: [
    { chat: 'Maya Okafor', network: 'WhatsApp', group: false, pile: 'primary' as const, save: true },
    {
      chat: 'Priya Natarajan',
      network: 'Signal',
      group: false,
      pile: 'primary' as const,
      save: false,
      reason: 'Signal is off',
    },
  ],
  complete: true,
}
const BEEPER_SIGN_IN = { id: 'b1', url: 'http://127.0.0.1:23373/oauth/authorize?state=s' }

const TYPESAFE: TypeSafeStatus = { connected: true, tail: '9d2e', models: ['jev-1.13.0'] }

test('connections preserves account presence on denied access and combines recovery requests', async () => {
  const { host } = hostWith()
  let recoveries = 0
  let release!: () => void
  let started!: () => void
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  host.secrets.get = async () => {
    throw new KeychainAccessError('access')
  }
  host.secrets.restoreAccess = async () => {
    recoveries++
    started()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  }
  const app = createConnectionsRoutes(host)
  const listing = (await (await app.request('/')).json()) as ConnectionsData
  assert({
    given: 'Keychain refuses reads',
    should: 'retain the account and explain access is blocked',
    actual: [listing.google.accounts.length, Boolean(listing.accessError)],
    expected: [1, true],
  })
  const first = app.request('/restore', { method: 'POST' })
  const second = app.request('/restore', { method: 'POST' })
  await began
  release()
  const replies = await Promise.all([first, second])
  assert({
    given: 'two simultaneous Restore access clicks',
    should: 'share one recovery and return only success status',
    actual: [recoveries, ...(await Promise.all(replies.map((r) => r.json())))],
    expected: [1, { ok: true }, { ok: true }],
  })
})

test('connections explains a failed recovery and allows a fresh attempt', async () => {
  const { host, app } = hostWith()
  host.secrets.restoreAccess = async () => {
    throw new KeychainAccessError('access', -25293)
  }
  const refused = await app.request('/restore', { method: 'POST' })
  const body = (await refused.json()) as { message: string }
  host.secrets.restoreAccess = async () => {}
  const recovered = await app.request('/restore', { method: 'POST' })
  assert({
    given: 'macOS refuses explicit recovery, then the next attempt succeeds',
    should: 'give a useful next step and release the previous failed attempt',
    actual: [refused.status, body.message, recovered.status, await recovered.json()],
    expected: [
      503,
      'macOS could not restore Keychain access. Open Keychain Access, lock and unlock your login keychain, then try again.',
      200,
      { ok: true },
    ],
  })
})

function hostWith(seed: Record<string, SecretEntry> = seeded()) {
  const secrets = new TestSecretsProvider(seed)
  const slackCalls: string[] = []
  const beeperRules: string[] = []
  let beeperRunning = true
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
      setup: { start: () => null, state: () => null, continue: () => false, cancel: () => false },
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
    beeper: {
      status: () => Promise.resolve(BEEPER),
      connect: () => Promise.resolve(BEEPER_SIGN_IN),
      connection: (id) => (id === BEEPER_SIGN_IN.id ? { status: 'waiting' } : null),
      token: async (token) => {
        if (token !== VALUES.beeper) return { ok: false, message: 'Beeper did not accept the token.' }
        await secrets.set('beeper', 'desktop', createSecret(JSON.stringify({ token, source: 'pasted' })))
        return { ok: true }
      },
      disconnect: () => secrets.delete('beeper', 'desktop'),
      rule: (id, change) => {
        beeperRules.push(`${id} ${JSON.stringify(change)}`)
        return Promise.resolve(id === 'sg1' || id === 'wa1')
      },
      preview: () => Promise.resolve(beeperRunning ? BEEPER_PREVIEW : null),
      check: () => {
        beeperRules.push('check')
        return Promise.resolve({ ran: true as const, chats: 2, messages: 3, files: 2, complete: true })
      },
      keep: (chat) => {
        beeperRules.push(`keep ${chat}`)
        return Promise.resolve(chat === '!held1')
      },
      open: (chat) => {
        beeperRules.push(`open ${chat}`)
        return Promise.resolve(beeperRunning ? chat === '!held1' : null)
      },
    },
    typesafe: {
      status: () => Promise.resolve(TYPESAFE),
      key: async (key) => {
        if (key !== VALUES.typesafe) return { ok: false, message: 'TypeSafe refused the key.' }
        await secrets.set('typesafe', 'main', createSecret(key))
        return { ok: true }
      },
      disconnect: () => secrets.delete('typesafe', 'main'),
    },
  }
  const app = createConnectionsRoutes(host)
  const withoutClient = () => {
    signIn = null
  }
  const closeBeeper = () => {
    beeperRunning = false
  }
  return { app, host, secrets, slackCalls, beeperRules, withoutClient, closeBeeper }
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
    should: 'answer the client as present and the account with its grants, naming the box left unticked',
    actual: [response.status, data.google.client, data.google.accounts],
    expected: [200, true, [{ email: 'jane@example.com', grants: ['Mail', 'Calendar', 'Drive'], missing: ['Docs'] }]],
  })
  assert({
    given: 'the rest of the keychain',
    should:
      'list every entry but the Google ones and the TypeSafe key, which has a row of its own — a provider key named after its provider, the filler name never printed, a login with its username, a long key by its tail and a short one without',
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
    expected: [400, 400, 400, 400, 400, 9],
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

test('connections - Beeper reports the app, starts its sign-in, takes a token, and disconnects', async () => {
  const { host } = hostWith()
  const app = createConnectionsRoutes(host)
  const headers = { 'Content-Type': 'application/json' }
  const status = await app.request('/beeper')
  const started = await app.request('/beeper/connect', { method: 'POST', headers, body: '{}' })
  const waiting = await app.request('/beeper/connect/b1')
  const unknown = await app.request('/beeper/connect/nope')
  const blank = await app.request('/beeper/token', { method: 'POST', headers, body: '{}' })
  const refused = await app.request('/beeper/token', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: 'wrong' }),
  })
  const saved = await app.request('/beeper/token', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: VALUES.beeper }),
  })
  const listing = await app.request('/')
  const listed = (await listing.json()) as ConnectionsData
  const listedText = JSON.stringify(listed)
  const stored = await host.secrets.get('beeper', 'desktop')
  const gone = await app.request('/beeper', { method: 'DELETE' })
  assert({
    given: 'the Beeper routes over a scripted host',
    should: 'answer each step, keep the grant out of the keychain list, and forget it on disconnect',
    actual: [
      [status.status, await status.json()],
      [started.status, await started.json()],
      [waiting.status, await waiting.json(), unknown.status],
      [blank.status, refused.status, (await refused.json()).message, saved.status],
      [stored?.type, listed.secrets.some((row) => row.category === 'beeper'), listedText.includes(VALUES.beeper)],
      [gone.status, await host.secrets.get('beeper', 'desktop')],
    ],
    expected: [
      [200, BEEPER],
      [200, BEEPER_SIGN_IN],
      [200, { status: 'waiting' }, 404],
      [400, 400, 'Beeper did not accept the token.', 200],
      ['secret', false, false],
      [200, null],
    ],
  })
})

test('connections - TypeSafe reports its key, stores one TypeSafe accepts, and forgets it', async () => {
  const { host, secrets } = hostWith()
  await secrets.delete('typesafe', 'main')
  const app = createConnectionsRoutes(host)
  const headers = { 'Content-Type': 'application/json' }
  const status = await app.request('/typesafe')
  const blank = await app.request('/typesafe/key', { method: 'POST', headers, body: '{}' })
  const refused = await app.request('/typesafe/key', {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: 'wrong' }),
  })
  const saved = await app.request('/typesafe/key', {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: ` ${VALUES.typesafe} ` }),
  })
  const stored = await secrets.get('typesafe', 'main')
  const listing = await app.request('/')
  const listed = (await listing.json()) as ConnectionsData
  const listedText = JSON.stringify(listed)
  const gone = await app.request('/typesafe', { method: 'DELETE' })
  assert({
    given: 'the TypeSafe routes over a scripted host',
    should:
      'answer the row, refuse a blank or unaccepted key, store an accepted one trimmed, keep it out of the keychain list and every answer, and forget it on remove',
    actual: [
      [status.status, await status.json()],
      [blank.status, (await blank.json()).message],
      [refused.status, (await refused.json()).message],
      [saved.status, stored?.type === 'secret' ? stored.val : null],
      [listed.secrets.some((row) => row.category === 'typesafe'), listedText.includes(VALUES.typesafe)],
      [gone.status, await secrets.get('typesafe', 'main')],
    ],
    expected: [
      [200, TYPESAFE],
      [400, 'Paste the API key from console.typesafe.ai.'],
      [400, 'TypeSafe refused the key.'],
      [200, VALUES.typesafe],
      [false, false],
      [200, null],
    ],
  })
})

test('connections - the Beeper page changes a rule, previews a check, and runs one', async () => {
  const { app, beeperRules, closeBeeper } = hostWith()
  const headers = { 'Content-Type': 'application/json' }
  const status = (await (await app.request('/beeper')).json()) as BeeperStatus
  const on = await app.request('/beeper/accounts/sg1', {
    method: 'POST',
    headers,
    body: JSON.stringify({ save: true }),
  })
  const groups = await app.request('/beeper/accounts/wa1', {
    method: 'POST',
    headers,
    body: JSON.stringify({ groups: false }),
  })
  const empty = await app.request('/beeper/accounts/wa1', {
    method: 'POST',
    headers,
    body: JSON.stringify({ save: 'yes' }),
  })
  const unknown = await app.request('/beeper/accounts/nope', {
    method: 'POST',
    headers,
    body: JSON.stringify({ save: true }),
  })
  const preview = await app.request('/beeper/preview')
  const check = await app.request('/beeper/check', { method: 'POST', headers, body: '{}' })
  const kept = await app.request('/beeper/held/!held1/keep', { method: 'POST', headers, body: '{}' })
  const notHeld = await app.request('/beeper/held/nope/keep', { method: 'POST', headers, body: '{}' })
  const opened = await app.request('/beeper/held/!held1/open', { method: 'POST', headers, body: '{}' })
  closeBeeper()
  const closed = await app.request('/beeper/preview')
  const closedOpen = await app.request('/beeper/held/!held1/open', { method: 'POST', headers, body: '{}' })
  assert({
    given: 'the Beeper page routes over a scripted host',
    should:
      'carry each account’s rule, the last run and the held chats; change a rule; refuse a bad or unknown one; preview, check, keep and open',
    actual: [
      [
        status.accounts.map((row) => `${row.network} ${row.save ? 'on' : 'off'}${row.holdUnknown ? ' holds' : ''}`),
        status.lastRun?.accountsOff,
        status.held.map((entry) => entry.who),
      ],
      [on.status, groups.status, empty.status, unknown.status],
      beeperRules,
      [preview.status, ((await preview.json()) as { rows: unknown[] }).rows.length],
      [check.status, await check.json()],
      [kept.status, ((await kept.json()) as { ran: boolean }).ran, notHeld.status, opened.status],
      [closed.status, ((await closed.json()) as { message: string }).message, closedOpen.status],
    ],
    expected: [
      [['WhatsApp on', 'Signal off holds'], ['Signal'], ['+1 (555) 010-2277']],
      [200, 200, 400, 404],
      [
        'sg1 {"save":true}',
        'wa1 {"groups":false}',
        'nope {"save":true}',
        'check',
        'keep !held1',
        'check',
        'keep nope',
        'open !held1',
        'open !held1',
      ],
      [200, 2],
      [200, { ran: true, chats: 2, messages: 3, files: 2, complete: true }],
      [200, true, 404, 200],
      [409, 'Open Beeper Desktop first.', 409],
    ],
  })
})
