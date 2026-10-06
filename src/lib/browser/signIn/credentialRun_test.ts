import { CredentialError } from '#lib/credentials/errors.ts'
import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import type { CredentialSummary } from '#lib/credentials/types.ts'
import { assert, test } from '#test'
import type { SignInTarget } from './broker.ts'
import { CredentialRun } from './credentialRun.ts'

function fixture() {
  const calls: string[] = []
  const signal = new AbortController()
  let included = true
  let excluded: string[] = []
  let ambiguous = false
  let incomplete = false
  let approved = true
  const item = (site: string, id = site): CredentialSummary => ({
    ref: { connectionId: 'example', containerId: 'vault', itemId: id },
    title: site,
    nativeCategory: 'Login',
    websites: [{ url: `https://${site}.example`, match: 'exact' }],
    tags: [],
  })
  const run = new CredentialRun({
    signal: signal.signal,
    sources: async () =>
      included ? [{ id: 'example', account: 'example', label: 'Example', excludedVaultIds: excluded }] : [],
    approval: {
      allowLookup: async () => {
        calls.push('approve')
        return approved
      },
      choose: async () => {
        calls.push('choose')
        return 0
      },
    },
    connect: async () => {
      calls.push('connect')
      return {
        setExcludedVaultIds: (ids) => {
          calls.push(`exclusions:${ids.join(',')}`)
        },
        list: async () => ({
          items: [item('atlas'), item('widget'), ...(ambiguous ? [item('atlas', 'alternate')] : [])],
          issues: incomplete ? [{ connectionId: 'example', error: new CredentialError('unavailable') }] : [],
        }),
        readLogin: async () => {
          calls.push('read')
          return {
            username: new SensitiveValue('jane@example.com'),
            password: new SensitiveValue('synthetic-password'),
          }
        },
      }
    },
  })
  const target = (site: string): SignInTarget => ({
    origin: `https://${site}.example`,
    current: async () => true,
    submit: async () => {
      calls.push('submit')
      return 'submitted'
    },
    dispose: async () => {},
  })
  return {
    run,
    calls,
    signal,
    target,
    exclude: () => {
      excluded = ['vault']
    },
    disconnect: () => {
      included = false
    },
    ambiguity: () => {
      ambiguous = true
    },
    partial: () => {
      incomplete = true
    },
    decline: () => {
      approved = false
    },
  }
}

test('one run approval and SDK connection cover unique matching logins across browser subtasks', async () => {
  const f = fixture()
  const first = await f.run.broker().signIn(f.target('atlas'))
  const second = await f.run.broker().signIn(f.target('widget'))
  assert({
    given: 'two website tasks in one approved run',
    should: 'connect and approve once, read each matching login freshly, and submit without a chooser',
    actual: [first, second, f.calls],
    expected: [
      { status: 'submitted' },
      { status: 'submitted' },
      ['approve', 'connect', 'exclusions:', 'read', 'submit', 'exclusions:', 'read', 'submit'],
    ],
  })
  f.exclude()
  const excluded = await f.run.broker().signIn(f.target('widget'))
  f.disconnect()
  const disconnected = await f.run.broker().signIn(f.target('atlas'))
  assert({
    given: 'changed vault and account settings in the same run',
    should: 'honor them before reading another password',
    actual: [excluded.reason, disconnected.reason, f.calls.filter((call) => call === 'read').length, f.calls.at(-1)],
    expected: ['no_matching_login', 'not_connected', 2, 'exclusions:vault'],
  })
})

test('run approval does not guess an ambiguous login or treat partial lookup as unique', async () => {
  const ambiguous = fixture()
  ambiguous.ambiguity()
  const partial = fixture()
  partial.partial()
  await ambiguous.run.broker().signIn(ambiguous.target('atlas'))
  await partial.run.broker().signIn(partial.target('atlas'))
  assert({
    given: 'multiple matching logins or an incomplete vault listing',
    should: 'require the native login choice even after run approval',
    actual: [ambiguous.calls.includes('choose'), partial.calls.includes('choose')],
    expected: [true, true],
  })
})

test('declined, stopped, and separate runs cannot reuse credential authorization', async () => {
  const declined = fixture()
  declined.decline()
  await declined.run.broker().signIn(declined.target('atlas'))
  await declined.run.broker().signIn(declined.target('widget'))
  const stopped = fixture()
  await stopped.run.broker().signIn(stopped.target('atlas'))
  stopped.signal.abort()
  const afterStop = await stopped.run.broker().signIn(stopped.target('widget'))
  const separate = fixture()
  await separate.run.broker().signIn(separate.target('widget'))
  assert({
    given: 'cancellation or another run',
    should: 'never connect after refusal, never read after stop, and ask independently for a separate run',
    actual: [
      declined.calls,
      afterStop.status,
      stopped.calls.filter((call) => call === 'read').length,
      separate.calls[0],
    ],
    expected: [['approve'], 'needs_user', 1, 'approve'],
  })
})
