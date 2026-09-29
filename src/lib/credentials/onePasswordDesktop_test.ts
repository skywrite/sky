import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { credentialError } from './errors.ts'
import {
  discoverOnePasswordAccounts,
  ensureOnePasswordCli,
  parseOnePasswordAccounts,
  type DesktopDiscoveryOptions,
} from './onePasswordDesktop.ts'

const account = { account_uuid: 'a'.repeat(26), email: 'jane@example.com', url: 'example.1password.com' }
const ok = { success: true, code: 0, stdout: '', stderr: '' }

test('desktop account discovery retains provider identity and projects only display metadata', () => {
  const row = { ...account, user_uuid: 'mock-user', unexpected: 'mock-sensitive-native-field' }
  const accounts = parseOnePasswordAccounts(JSON.stringify([row, row]))
  assert({
    given: 'duplicate account records with extra native fields',
    should: 'retain one stable provider ID and its display label only',
    actual: accounts,
    expected: [{ id: account.account_uuid, label: 'jane@example.com · example.1password.com' }],
  })
  const failures = ['mock-sensitive-invalid-json', JSON.stringify([{ ...row, account_uuid: '../mock-invalid' }])].map(
    (raw) => {
      try {
        parseOnePasswordAccounts(raw)
      } catch (error) {
        return credentialError(error).toJSON()
      }
      return null
    },
  )
  assert({
    given: 'malformed native output',
    should: 'return only a fixed error without carrying input values',
    actual: failures,
    expected: Array(2).fill({
      code: 'unavailable',
      message: 'The credential provider could not complete the request.',
    }),
  })
})

test('desktop discovery requests account metadata and removes conflicting authentication modes', async () => {
  const calls: unknown[] = []
  const options: DesktopDiscoveryOptions = {
    helperDir: '/unused',
    platform: 'linux',
    findCli: async () => '/mock/op',
    run: async (command, args, settings) => {
      calls.push([command, args, settings?.env])
      return { ...ok, stdout: JSON.stringify([account]) }
    },
    download: async () => {
      throw new Error('An installed helper must be reused')
    },
  }
  const accounts = await discoverOnePasswordAccounts(options)
  assert({
    given: 'an installed helper and desktop accounts',
    should: 'discover without sign-in input or a vault read',
    actual: [accounts.length, calls],
    expected: [
      1,
      [
        [
          '/usr/bin/env',
          [
            '-u',
            'OP_SERVICE_ACCOUNT_TOKEN',
            '-u',
            'OP_CONNECT_HOST',
            '-u',
            'OP_CONNECT_TOKEN',
            '-u',
            'OP_ACCOUNT',
            '/mock/op',
            'account',
            'list',
            '--format=json',
          ],
          { OP_BIOMETRIC_UNLOCK_ENABLED: 'true' },
        ],
      ],
    ],
  })
  const failures: unknown[] = []
  for (const result of [
    { ...ok, stdout: '[]' },
    { ...ok, success: false, stderr: 'desktop app integration disabled: mock-native-detail' },
    { ...ok, success: false, stderr: 'mock-sensitive-native-error' },
  ]) {
    failures.push(
      await discoverOnePasswordAccounts({ ...options, run: async () => result }).catch(
        (error) => credentialError(error).code,
      ),
    )
  }
  assert({
    given: 'missing accounts, disabled integration and an unknown native failure',
    should: 'provide actionable sanitized failures',
    actual: failures,
    expected: ['no-accounts', 'integration-required', 'unavailable'],
  })
})

test('a helper with the verified vendor signature is reused without an install', async () => {
  const verifications: string[][] = []
  const helper = await ensureOnePasswordCli({
    helperDir: '/unused',
    platform: 'darwin',
    findCli: async () => '/mock/op',
    run: async (command, args = []) => {
      verifications.push([command, ...args])
      return ok
    },
    download: async () => {
      throw new Error('Must not download')
    },
  })
  assert({
    given: 'an existing signed 1Password CLI',
    should: 'verify its identity before returning it',
    actual: [
      helper,
      verifications.length,
      verifications[0][0],
      verifications[0][4].startsWith('=anchor apple generic'),
      verifications[0].at(-1),
    ],
    expected: ['/mock/op', 1, '/usr/bin/codesign', true, '/mock/op'],
  })
})

test('untrusted helpers and altered downloads never execute and temporary downloads are removed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-op-helper-'))
  try {
    const commands: string[] = []
    const result = await ensureOnePasswordCli({
      helperDir: dir,
      platform: 'darwin',
      arch: 'arm64',
      findCli: async () => '/mock/untrusted-op',
      run: async (command) => {
        commands.push(command)
        return { ...ok, success: false }
      },
      download: async () => new TextEncoder().encode('mock-altered-download'),
    }).catch((error) => credentialError(error).code)
    const entries = await readdir(dir, { recursive: true })
    assert({
      given: 'an invalid signature followed by an archive with the wrong checksum',
      should: 'refuse extraction or execution and leave no archive or executable',
      actual: [result, commands, entries.some((entry) => entry.includes('.download-') || entry.endsWith('/op'))],
      expected: ['helper-unavailable', ['/usr/bin/codesign'], false],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
