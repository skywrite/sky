import Follow from '#shared/models/Follow/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { FetchedThread } from './fetchUnsavedThreads.ts'
import { planThreadFollow, selectExpiredFollows } from './followLifecycle.ts'
import type { FollowEntry } from './followLifecycle.ts'

const NOW = PlainDateTime.fromString('2026-08-12 10:00')

function thread(overrides: Partial<FetchedThread> = {}): FetchedThread {
  return {
    threadId: '1234567890',
    from: 'Jane Doe',
    subject: 'Atlas kickoff',
    messages: [{ date: '2026-08-10', path: 'time/2026/08/10_mon/09-30_email_Jane-Doe_Atlas-kickoff.md' }],
    lastMessageAt: '2026-08-10 09:30',
    ...overrides,
  }
}

function plan(t: FetchedThread, force = false) {
  return planThreadFollow({ accountEmail: 'user@example.com', label: 'Sky/Follow', thread: t, now: NOW, force })
}

test('planThreadFollow keeps a recently active thread live', () => {
  const { follow, bornExpired, fileName } = plan(thread())

  assert({ given: 'activity two days ago', should: 'not be born expired', expected: false, actual: bornExpired })
  assert({ given: 'a live thread', should: 'stay active', expected: 'active', actual: follow.status })
  assert({
    given: 'a real message time',
    should: 'anchor lastActivity on the message, not now',
    expected: '2026-08-10 09:30',
    actual: follow.lastActivity ? `${follow.lastActivity.date} ${follow.lastActivity.time}` : '(none)',
  })
  assert({ given: 'one captured entry', should: 'record it', expected: 1, actual: follow.messages.length })
  assert({
    given: 'the capture date',
    should: 'prefix the file name',
    expected: true,
    actual: fileName.startsWith('2026-08-12_email_'),
  })
})

test('planThreadFollow declines a thread quiet past the expiry window', () => {
  const t = thread({
    messages: [{ date: '2026-07-20', path: 'time/2026/07/20_mon/09-00_email_Jane-Doe_Atlas-kickoff.md' }],
    lastMessageAt: '2026-07-20 09:00',
  })
  const { follow, bornExpired } = plan(t)

  assert({ given: '23 days of silence', should: 'be born expired', expected: true, actual: bornExpired })
  assert({ given: 'a born-expired thread', should: 'close the follow', expected: 'closed', actual: follow.status })
  assert({ given: 'captured entries', should: 'still be recorded', expected: 1, actual: follow.messages.length })
})

test('planThreadFollow judges expiry on real activity even when the capture is collapsed to today', () => {
  const t = thread({
    messages: [{ date: '2026-08-12', path: 'time/2026/08/12_wed/10-00_email_Jane-Doe_Atlas-kickoff.md' }],
    lastMessageAt: '2026-07-20 09:00',
  })
  const { bornExpired } = plan(t)

  assert({
    given: 'a --when capture dated today of a long-quiet thread',
    should: 'still be born expired',
    expected: true,
    actual: bornExpired,
  })
})

test('planThreadFollow --force follows a quiet thread anyway', () => {
  const t = thread({
    messages: [{ date: '2026-07-20', path: 'time/2026/07/20_mon/09-00_email_Jane-Doe_Atlas-kickoff.md' }],
    lastMessageAt: '2026-07-20 09:00',
  })
  const { follow, bornExpired } = plan(t, true)

  assert({ given: 'force', should: 'not be born expired', expected: false, actual: bornExpired })
  assert({ given: 'force', should: 'stay active', expected: 'active', actual: follow.status })
})

test('planThreadFollow falls back to now when no message time is known', () => {
  const { lastMessageAt: _omit, ...bare } = thread()
  const { follow, bornExpired } = plan(bare)

  assert({ given: 'no message dates', should: 'not be born expired', expected: false, actual: bornExpired })
  assert({
    given: 'no message dates',
    should: 'anchor lastActivity on now',
    expected: '2026-08-12 10:00',
    actual: follow.lastActivity ? `${follow.lastActivity.date} ${follow.lastActivity.time}` : '(none)',
  })
})

function followEntry(opts: {
  fileName: string
  status?: 'active' | 'paused' | 'closed'
  account?: string
  lastActivity?: string
  expires?: string
}): FollowEntry {
  const follow = Follow.create({
    source: 'Email',
    ref: { account: opts.account ?? 'user@example.com', threadId: '42', label: 'Sky/Follow' },
    summary: 'Atlas kickoff',
    followSince: PlainDateTime.fromString('2026-07-01 08:00'),
    ...(opts.expires ? { expires: PlainDateTime.fromString(opts.expires) } : {}),
    ...(opts.lastActivity ? { lastActivity: PlainDateTime.fromString(opts.lastActivity) } : {}),
    messages: [],
    status: opts.status ?? 'active',
  })
  return { follow, path: `state/follow/email/active/${opts.fileName}.yaml`, fileName: opts.fileName }
}

test('selectExpiredFollows picks only this account’s quiet active follows', () => {
  const quiet = followEntry({ fileName: 'quiet', lastActivity: '2026-07-20 09:00' })
  const fresh = followEntry({ fileName: 'fresh', lastActivity: '2026-08-10 09:00' })
  const closed = followEntry({ fileName: 'closed', status: 'closed', lastActivity: '2026-07-20 09:00' })
  const foreign = followEntry({ fileName: 'foreign', account: 'other@example.com', lastActivity: '2026-07-20 09:00' })
  const pinned = followEntry({ fileName: 'pinned', lastActivity: '2026-07-20 09:00', expires: '2026-12-31 23:59' })
  const cased = followEntry({ fileName: 'cased', account: 'User@Example.com', lastActivity: '2026-07-20 09:00' })

  const picked = selectExpiredFollows([quiet, fresh, closed, foreign, pinned, cased], 'user@example.com', NOW)

  assert({
    given: 'quiet, fresh, closed, foreign-account, future-expires, and case-varied follows',
    should: 'select the quiet active ones owned by the account',
    expected: 'cased, quiet',
    actual: picked
      .map((e) => e.fileName)
      .sort()
      .join(', '),
  })
})
