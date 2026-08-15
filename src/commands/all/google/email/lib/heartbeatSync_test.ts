import { GMAIL_SCOPE } from '#lib/google/mod.ts'
import { assert, test } from '#test'
import { selectSyncableAccounts, sweepTotals } from './heartbeatSync.ts'
import type { AccountSync } from './heartbeatSync.ts'

const withGmail = { refreshToken: 'rt', scopes: [GMAIL_SCOPE] }
const withoutGmail = { refreshToken: 'rt', scopes: ['https://www.googleapis.com/auth/drive'] }

test('selectSyncableAccounts runs the accounts whose grant allows Gmail', () => {
  const { runnable } = selectSyncableAccounts([
    { email: 'first@example.com', tokens: withGmail },
    { email: 'second@example.com', tokens: withGmail },
  ])

  assert({
    given: 'two Gmail-scoped grants',
    should: 'run both',
    expected: 'first@example.com, second@example.com',
    actual: runnable.join(', '),
  })
})

test('selectSyncableAccounts skips an unusable grant without stopping the others', () => {
  const { runnable, skipped } = selectSyncableAccounts([
    { email: 'scoped@example.com', tokens: withGmail },
    { email: 'stale@example.com', tokens: withoutGmail },
    { email: 'missing@example.com', tokens: null },
  ])

  assert({
    given: 'one good grant beside a pre-Gmail-scope one and a missing one',
    should: 'still run the good account',
    expected: 'scoped@example.com',
    actual: runnable.join(', '),
  })
  assert({
    given: 'the unusable grants',
    should: 'report each with its reason',
    expected: 'stale@example.com: grant lacks the Gmail scope | missing@example.com: no stored grant',
    actual: skipped.map((s) => `${s.account}: ${s.reason}`).join(' | '),
  })
})

function account(overrides: Partial<AccountSync> = {}): AccountSync {
  return {
    account: 'first@example.com',
    newFollows: 0,
    updatedFollows: 0,
    bornExpired: 0,
    expired: 0,
    fetchedMessages: 0,
    ...overrides,
  }
}

test('sweepTotals adds every account into one line', () => {
  const totals = sweepTotals({
    ran: [
      account({ newFollows: 2, fetchedMessages: 5, expired: 1 }),
      account({ account: 'second@example.com', updatedFollows: 3, fetchedMessages: 4, bornExpired: 1 }),
    ],
    skipped: [],
  })

  assert({
    given: 'two accounts that each captured and retired something',
    should: 'sum each count across them',
    expected: '2 new, 3 updated, 1 born-expired, 1 expired, 9 messages, 0 errors',
    actual: `${totals.newFollows} new, ${totals.updatedFollows} updated, ${totals.bornExpired} born-expired, ${totals.expired} expired, ${totals.fetchedMessages} messages, ${totals.errors} errors`,
  })
})

test('sweepTotals counts a failed account without losing the others', () => {
  const totals = sweepTotals({
    ran: [account({ newFollows: 2 }), account({ account: 'second@example.com', error: 'invalid_grant' })],
    skipped: [],
  })

  assert({
    given: 'one account that synced and one that failed',
    should: 'keep the successful counts and record the failure',
    expected: '2 new, 1 errors',
    actual: `${totals.newFollows} new, ${totals.errors} errors`,
  })
})
