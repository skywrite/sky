import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KeychainAccessError } from '#lib/secrets/keychainProtocol.ts'
import { assert, test } from '#test'
import {
  SlackConnection,
  slackWorkspaceUrl,
  type SlackConnectionHost,
  type SlackCredentialConfig,
} from './connection.ts'

const WORKSPACE = 'https://atlas.slack.com'
const OK = { success: true, code: 0, stderr: '', stdout: '{"ok":true,"url":"https://atlas.slack.com/"}' }
const CONFIG: SlackCredentialConfig = {
  default_workspace_url: WORKSPACE,
  workspaces: [
    {
      workspace_url: WORKSPACE,
      auth: { auth_type: 'browser', xoxc_token: '__KEYCHAIN__', xoxd_cookie: '__KEYCHAIN__' },
    },
    { workspace_url: 'https://widget.slack.com', auth: { auth_type: 'standard', token: '__KEYCHAIN__' } },
  ],
}

async function fixture(run: (host: SlackConnectionHost, connection: SlackConnection) => Promise<void>) {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'sky-slack-connection-'))
  const host: SlackConnectionHost = {
    stateDir,
    macOS: true,
    config: async () => CONFIG,
    now: () => 1_000,
    secret: async (account) => (account === 'xoxd' ? 'xoxd-synthetic' : 'xoxc-synthetic'),
    restoreKeychain: async () => {},
    run: async () => ({ ...OK }),
    importBrave: async () => ({ ...OK }),
  }
  try {
    await run(host, new SlackConnection(host))
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
}

test('100 scheduled checks against denied Keychain access stop after one silent read, including after restart', async () => {
  await fixture(async (host, connection) => {
    let reads = 0
    let calls = 0
    let prompts = 0
    host.secret = async (_account, interactive) => {
      reads++
      if (interactive) prompts++
      throw new KeychainAccessError('access', -25308)
    }
    host.run = async () => {
      calls++
      return { ...OK }
    }
    const results = await Promise.all(Array.from({ length: 100 }, () => connection.run(['auth', 'test'])))
    const restarted = await new SlackConnection(host).run([
      'message',
      'get',
      `${WORKSPACE}/archives/C_TEST/p1700000000000000`,
    ])
    assert({
      given: 'a denied credential and 100 concurrent scheduled checks plus a new service instance',
      should: 'persist the pause, never launch Slack or ask for authentication',
      actual: [
        reads,
        calls,
        prompts,
        results.every((result) => result.issue?.reason === 'keychain'),
        restarted.issue?.reason,
      ],
      expected: [1, 0, 0, true, 'keychain'],
    })
  })
})

test('only the selected workspace and shared cookie are read; discovery reads no secrets', async () => {
  await fixture(async (host, connection) => {
    const accounts: string[] = []
    host.secret = async (account) => {
      accounts.push(account)
      return account === 'xoxd' ? 'xoxd-synthetic' : 'xoxc-synthetic'
    }
    const whoami = await connection.run(['auth', 'whoami'])
    await connection.run(['message', 'get', `${WORKSPACE}/archives/C_TEST/p1700000000000000`])
    assert({
      given: 'metadata discovery followed by a message in one of two workspaces',
      should: 'exclude values from discovery and read just that workspace',
      actual: [accounts, whoami.stdout.includes('__KEYCHAIN__'), whoami.stdout.includes('synthetic')],
      expected: [[`xoxc:${WORKSPACE}`, 'xoxd'], false, false],
    })
  })
})

test('Keychain failure, API rejection and network errors have distinct recovery behavior', async () => {
  await fixture(async (host, connection) => {
    let calls = 0
    let imports = 0
    host.importBrave = async () => {
      imports++
      return { ...OK }
    }
    host.run = async () => {
      calls++
      return { success: false, code: 1, stdout: '', stderr: 'invalid_auth' }
    }
    const rejected = await connection.run(['auth', 'test'])
    await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'a saved token rejected by Slack',
      should: 'pause without attempting an import',
      actual: [rejected.issue?.reason, calls, imports],
      expected: ['expired', 1, 0],
    })
    host.run = async () => ({ success: false, code: 1, stdout: '', stderr: 'fetch failed: ECONNRESET' })
    const network = await connection.recover()
    assert({
      given: 'explicit recovery reaches a network failure',
      should: 'use a cooldown and leave browser authentication alone',
      actual: [network.issue?.reason, network.issue?.retryAt, imports],
      expected: ['network', 61_000, 0],
    })
  })
})

test('explicit recovery joins concurrent requests, restores existing credentials and resumes without importing', async () => {
  await fixture(async (host, connection) => {
    let restored = false
    let restores = 0
    let imports = 0
    let prompts = 0
    host.secret = async (account, interactive) => {
      if (!restored) throw new KeychainAccessError('access', -25308)
      if (interactive) prompts++
      return account === 'xoxd' ? 'xoxd-synthetic' : 'xoxc-synthetic'
    }
    host.restoreKeychain = async () => {
      restores++
      restored = true
    }
    host.importBrave = async () => {
      imports++
      return { ...OK }
    }
    await connection.run(['auth', 'test'])
    const recovered = await Promise.all([connection.recover(), connection.recover()])
    const next = await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'two Restore access clicks and saved tokens that still work',
      should: 'run one recovery, authorize only its reads, keep the tokens and resume future checks',
      actual: [restores, imports, prompts, recovered.every((result) => result.success), next.success],
      expected: [1, 0, 2, true, true],
    })
  })
})

test('cancelling native recovery keeps Slack paused and never imports from Brave', async () => {
  await fixture(async (host, connection) => {
    let imports = 0
    host.secret = async () => {
      throw new KeychainAccessError('access', -25308)
    }
    host.restoreKeychain = async () => {
      throw new KeychainAccessError('access', -128)
    }
    host.importBrave = async () => {
      imports++
      return { ...OK }
    }
    await connection.run(['auth', 'test'])
    const recovered = await connection.recover()
    const next = await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'the owner cancels the OS prompt',
      should: 'keep the pause across a restart',
      actual: [imports, recovered.issue?.reason, next.issue?.reason],
      expected: [0, 'keychain', 'keychain'],
    })
  })
})

test('only an explicit recovery imports an expired session; pause state contains no credentials', async () => {
  await fixture(async (host, connection) => {
    let imported = false
    host.run = async () => (imported ? { ...OK } : { success: false, code: 1, stdout: '', stderr: 'token_expired' })
    host.importBrave = async () => {
      imported = true
      return { ...OK }
    }
    await connection.run(['auth', 'test'])
    const { readdir } = await import('node:fs/promises')
    const file = (await readdir(host.stateDir)).find((name) => name.endsWith('.json'))!
    const paused = await readFile(path.join(host.stateDir, file), 'utf8')
    const recovered = await connection.recover()
    assert({
      given: 'Slack explicitly rejected the token',
      should: 'refresh only on deliberate recovery and persist no secrets',
      actual: [imported, recovered.success, paused.includes('xoxc-synthetic'), paused.includes('xoxd-synthetic')],
      expected: [true, true, false, false],
    })
  })
})

test('recovery can target a paused workspace other than the configured default', async () => {
  await fixture(async (host, connection) => {
    const widget = 'https://widget.slack.com'
    const accounts: string[] = []
    host.secret = async (account) => {
      accounts.push(account)
      return 'xoxp-synthetic'
    }
    host.run = async (_args, credentials) => ({
      ...OK,
      stdout: JSON.stringify({ ok: true, url: credentials.workspace }),
    })
    await connection.pause(WORKSPACE)
    await connection.pause(widget)
    const recovered = await connection.recover(widget)
    const atlas = await new SlackConnection(host).run(['auth', 'test'])
    const widgetNext = await new SlackConnection(host).run(['auth', 'test', '--workspace', widget])
    assert({
      given: 'two paused workspaces and an explicit recovery for the second',
      should: 'read only its token, resume it and preserve the other pause',
      actual: [recovered.success, atlas.issue?.reason, widgetNext.success, accounts],
      expected: [true, 'paused', true, [`token:${widget}`, `token:${widget}`]],
    })
  })
})

test('credentials never go to arbitrary workspace URLs', async () => {
  const refused = [
    'http://atlas.slack.com',
    'https://atlas.slack.com.example.com',
    'https://example.com',
    'https://user@atlas.slack.com',
    'https://atlas.slack.com:8443',
  ]
  assert({
    given: 'untrusted origins and Slack-shaped lookalikes',
    should: 'reject them before a credential read or process launch',
    actual: refused.every((url) => {
      try {
        slackWorkspaceUrl(url)
        return false
      } catch {
        return true
      }
    }),
    expected: true,
  })
})

test('a response from before recovery cannot pause the refreshed connection', async () => {
  await fixture(async (host, connection) => {
    let finish!: (result: Awaited<ReturnType<SlackConnectionHost['run']>>) => void
    let began!: () => void
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    host.run = async () => {
      began()
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const oldRequest = connection.run(['message', 'get', `${WORKSPACE}/archives/C_TEST/p1700000000000000`])
    await started
    host.run = async () => ({ ...OK })
    await connection.recover()
    finish({ success: false, code: 1, stdout: '', stderr: 'invalid_auth' })
    await oldRequest
    const next = await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'an old request fails after recovery succeeded',
      should: 'keep the new connection active',
      actual: [next.success, await connection.issues()],
      expected: [true, []],
    })
  })
})

test('pausing while recovery is in flight remains paused when that recovery finishes', async () => {
  await fixture(async (host, connection) => {
    let finish!: (result: Awaited<ReturnType<SlackConnectionHost['run']>>) => void
    let began!: () => void
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    host.run = async () => {
      began()
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const recovery = connection.recover()
    await started
    await new SlackConnection(host).pause()
    finish({ ...OK })
    await recovery
    const next = await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'the owner pauses while an explicit recovery is testing credentials',
      should: 'preserve the newer pause across processes',
      actual: next.issue?.reason,
      expected: 'paused',
    })
  })
})

test('a network cooldown expires without prompting or importing credentials', async () => {
  await fixture(async (host, connection) => {
    let now = 1_000
    let calls = 0
    host.now = () => now
    host.run = async () => {
      calls++
      return { success: false, code: 1, stdout: '', stderr: 'ECONNRESET' }
    }
    await connection.run(['auth', 'test'])
    await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'a network failure before the cooldown expires',
      should: 'avoid repeated requests',
      actual: calls,
      expected: 1,
    })
    now = 61_001
    host.run = async () => {
      calls++
      return { ...OK }
    }
    const next = await new SlackConnection(host).run(['auth', 'test'])
    assert({
      given: 'the cooldown expires',
      should: 'retry silently and hide the old notice',
      actual: [calls, next.success, await connection.issues()],
      expected: [2, true, []],
    })
  })
})
