import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { CredentialError } from '#lib/credentials/errors.ts'
import { assert, test } from '#test'
import { createSettingsRoutes, type SettingsRoutesOptions } from '../mod.ts'
import { BrowserAutomationHost } from './host.ts'
import { createBrowserAutomationRoutes } from './routes.ts'
import { browserAutomationTestHost, SAMPLE_ACCOUNT, SAMPLE_ID, SAMPLE_PASSWORD } from './testHost.ts'

async function fixture(work: (f: ReturnType<typeof browserAutomationTestHost>, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-browser-settings-'))
  try {
    await work(browserAutomationTestHost(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
const headers = { 'Content-Type': 'application/json' }

test('browser settings read only saved metadata, including after a restart or failed native access', async () =>
  fixture(async (f, dir) => {
    const initial = await f.host.snapshot()
    await Promise.all([f.host.connect(), f.host.connect()])
    const providerCalls = { ...f.counts }
    f.state.inspectionFailure = true
    const connected = await f.host.snapshot()
    const restarted = await new BrowserAutomationHost(f.options).snapshot()
    const saved = await readFile(path.join(dir, 'sources.json'), 'utf8')
    assert({
      given: 'duplicate Connect clicks, a locked provider, and a restarted service',
      should: 'read setup without native calls, item metadata, secret values, or automatic sign-in',
      actual: [
        initial,
        connected,
        restarted,
        f.counts,
        saved.includes(SAMPLE_PASSWORD),
        (await stat(path.join(dir, 'sources.json'))).mode & 0o777,
      ],
      expected: [
        { passwordManagers: [], signIn: 'manual' },
        {
          passwordManagers: [
            {
              id: SAMPLE_ID,
              account: SAMPLE_ACCOUNT,
              label: SAMPLE_ACCOUNT,
              excludedVaultIds: [],
              containers: [
                { id: 'work', label: 'Work' },
                { id: 'personal', label: 'Personal' },
              ],
              provider: '1password',
            },
          ],
          signIn: 'approval',
        },
        connected,
        providerCalls,
        false,
        0o600,
      ],
    })
    assert({
      given: 'successful setup',
      should: 'inspect vaults once and never touch items',
      actual: f.counts,
      expected: { inspected: 1, discovered: 1, vaultLists: 1, itemLists: 0, read: 0, write: 0, opened: 0 },
    })
  }))

test('one Connect approves accounts sequentially and preserves successes when a later account is declined', async () =>
  fixture(async (f) => {
    const accounts = [
      { id: 'a'.repeat(26), label: 'Example personal' },
      { id: 'b'.repeat(26), label: 'Example work' },
    ]
    const order: string[] = []
    const inspect = f.options.inspectAccount
    let decline = true
    f.options.discover = async () => accounts
    f.options.inspectAccount = async (source) => {
      order.push(source.account)
      if (source.account === accounts[1].id && decline) throw new CredentialError('access-required')
      return inspect(source)
    }
    const app = createBrowserAutomationRoutes(f.host)
    const request = () => app.request('http://localhost/connect', { method: 'POST', headers, body: '{}' })
    const first = await request()
    const partial = await f.host.snapshot()
    decline = false
    const second = await request()
    const saved = await f.host.snapshot()
    assert({
      given: 'a declined approval followed by retry',
      should: 'retry only the remaining account without a typed identifier',
      actual: [
        first.status,
        partial.passwordManagers.map((source) => source.account),
        second.status,
        saved.passwordManagers.map((source) => [source.account, source.label]),
        order,
      ],
      expected: [
        503,
        [accounts[0].id],
        200,
        accounts.map((account) => [account.id, account.label]),
        [accounts[0].id, accounts[1].id, accounts[1].id],
      ],
    })
  }))

test('saved vault preferences survive explicit refresh and are never credential-use permissions', async () =>
  fixture(async (f, dir) => {
    await f.host.connect()
    await f.host.settings.update((settings) => {
      settings.destination = { connectionId: SAMPLE_ID, containerId: 'work' }
    })
    await f.host.setVaults(SAMPLE_ID, ['work'])
    f.vaults.push({ id: 'shared', title: 'Shared' })
    const beforeRefresh = await f.host.snapshot()
    const restarted = new BrowserAutomationHost(f.options)
    await restarted.refresh(SAMPLE_ID)
    const refreshed = await restarted.snapshot()
    await restarted.setVaults(SAMPLE_ID, [])
    const all = await restarted.snapshot()
    await restarted.disconnect(SAMPLE_ID)
    assert({
      given: 'old account preferences, a new vault, and an explicit refresh after restart',
      should: 'retain identity and exclusions and describe approval without granting access',
      actual: [
        beforeRefresh.passwordManagers[0].containers.length,
        refreshed.passwordManagers[0].containers.length,
        refreshed.passwordManagers[0].excludedVaultIds,
        all.passwordManagers[0].excludedVaultIds,
        all.signIn,
        await restarted.snapshot(),
        (await restarted.settings.read()).destination,
        f.counts.itemLists,
        f.counts.read,
        f.counts.write,
        (await readFile(path.join(dir, 'sources.json'), 'utf8')).includes(SAMPLE_PASSWORD),
      ],
      expected: [2, 3, ['work'], [], 'approval', { passwordManagers: [], signIn: 'manual' }, null, 0, 0, 0, false],
    })
  }))

test('both old and new settings paths reject item access, mutation, and browser execution', async () =>
  fixture(async (f) => {
    await f.host.connect()
    // These requests exercise only the mounted setup routes, never the other Settings hosts.
    const app = createSettingsRoutes({ browserAutomation: f.host } as SettingsRoutesOptions)
    const attempts: number[] = []
    const replies: string[] = []
    for (const operation of [
      '',
      '/inspect',
      '/read',
      '/otp',
      '/create',
      '/update',
      '/delete',
      '/destination',
      '/restore',
      '/connect',
    ]) {
      const response = await app.request(`http://localhost/credentials${operation}`, {
        method: operation ? 'POST' : 'GET',
        ...(operation ? { headers, body: JSON.stringify({ value: SAMPLE_PASSWORD }) } : {}),
      })
      attempts.push(response.status)
      replies.push(await response.text())
    }
    for (const operation of [
      'inspect',
      'read',
      'otp',
      'create',
      'update',
      'delete',
      'destination',
      'restore',
      'sign-in',
      'execute',
      'approve',
    ]) {
      const response = await app.request(`http://localhost/browser-automation/${operation}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: SAMPLE_PASSWORD }),
      })
      attempts.push(response.status)
      replies.push(await response.text())
    }
    const get = await app.request('http://localhost/browser-automation')
    const body = await get.json()
    assert({
      given: 'an API caller who knows the former item endpoints and tries analogous new routes',
      should: 'retire the old API, deny item operations and execution, and expose only saved setup',
      actual: [
        attempts,
        replies.some((reply) => reply.includes(SAMPLE_PASSWORD)),
        Object.keys(body).sort(),
        get.headers.get('cache-control'),
        f.counts.itemLists,
        f.counts.read,
        f.counts.write,
      ],
      expected: [
        [...Array(10).fill(410), ...Array(11).fill(404)],
        false,
        ['passwordManagers', 'signIn'],
        'no-store',
        0,
        0,
        0,
      ],
    })
  }))

test('setup routes reject cross-origin requests, malformed fields, and attempts to enable automatic sign-in', async () =>
  fixture(async (f) => {
    const app = createBrowserAutomationRoutes(f.host)
    const send = (operation: string, body: unknown, extra: Record<string, string> = {}) =>
      app.request(`http://localhost/${operation}`, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify(body),
      })
    const replies = await Promise.all([
      send('connect', {}, { Origin: 'https://example.com' }),
      send('connect', { account: SAMPLE_ACCOUNT }),
      send('connect', { signIn: 'automatic', value: SAMPLE_PASSWORD }),
      send('vaults', { id: SAMPLE_ID, excludedVaultIds: [], approved: true }),
      send('connect', {}, { 'Content-Type': 'text/plain' }),
    ])
    assert({
      given: 'untrusted or malformed setup requests',
      should: 'reject them before native access and never echo submitted secrets',
      actual: [
        replies.map((reply) => reply.status),
        (await Promise.all(replies.map((reply) => reply.text()))).some((reply) => reply.includes(SAMPLE_PASSWORD)),
        f.counts.discovered,
        f.counts.inspected,
      ],
      expected: [[403, 400, 400, 400, 415], false, 0, 0],
    })
  }))

test('failed native setup is sanitized and preserves saved configuration', async () =>
  fixture(async (f, dir) => {
    f.options.discover = async () => {
      throw new CredentialError('integration-required')
    }
    const first = await f.host.connect().catch((error) => error.code)
    f.options.discover = async () => []
    const empty = await f.host.connect().catch((error) => error.code)
    f.options.discover = async () => [{ id: SAMPLE_ACCOUNT, label: SAMPLE_ACCOUNT }]
    await f.host.connect()
    const original = await readFile(path.join(dir, 'sources.json'), 'utf8')
    f.state.inspectionFailure = true
    const failure = await createBrowserAutomationRoutes(f.host).request('http://localhost/refresh', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: SAMPLE_ID }),
    })
    assert({
      given: 'discovery failures and a provider refresh error containing secret text',
      should: 'allow retry, redact provider errors, and retain the last successful setup',
      actual: [
        first,
        empty,
        failure.status,
        (await failure.text()).includes(SAMPLE_PASSWORD),
        await readFile(path.join(dir, 'sources.json'), 'utf8'),
      ],
      expected: ['integration-required', 'no-accounts', 503, false, original],
    })
    await writeFile(path.join(dir, 'sources.json'), 'not valid JSON')
    const corrupt = await f.host.disconnect(SAMPLE_ID).catch((error) => error.code)
    assert({
      given: 'corrupt configuration',
      should: 'refuse to silently replace it',
      actual: [corrupt, await readFile(path.join(dir, 'sources.json'), 'utf8')],
      expected: ['unavailable', 'not valid JSON'],
    })
  }))
