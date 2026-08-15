import Follow from '#shared/models/Follow/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { FetchedThread } from './fetchUnsavedThreads.ts'
import { planThreadFollow, selectExpiredFollows, uniqueFollowFileName } from './followLifecycle.ts'
import type { FollowEntry } from './followLifecycle.ts'

const NOW = PlainDateTime.fromString('2026-08-12 10:00')

function thread(overrides: Partial<FetchedThread> = {}): FetchedThread {
  return {
    threadId: '1234567890',
    from: 'Jane Doe',
    subject: 'Atlas kickoff',
    messages: [
      { date: '2026-08-10', path: 'time/2026/08/10-16/08-10/actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md' },
    ],
    captured: 1,
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
    given: 'a capture path in the current layout',
    should: 'store it as a time ref — follows must outlive the layout',
    expected: '2026-08-10/actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md',
    actual: follow.messages[0].path,
  })
  assert({
    given: 'the capture date',
    should: 'prefix the file name',
    expected: true,
    actual: fileName.startsWith('2026-08-12_email_'),
  })
})

test('planThreadFollow declines a thread quiet past the expiry window', () => {
  const t = thread({
    messages: [
      { date: '2026-07-20', path: 'time/2026/07/20-26/07-20/actions/messages/09-00_email_Jane-Doe_Atlas-kickoff.md' },
    ],
    lastMessageAt: '2026-07-20 09:00',
  })
  const { follow, bornExpired } = plan(t)

  assert({ given: '23 days of silence', should: 'be born expired', expected: true, actual: bornExpired })
  assert({ given: 'a born-expired thread', should: 'close the follow', expected: 'closed', actual: follow.status })
  assert({ given: 'captured entries', should: 'still be recorded', expected: 1, actual: follow.messages.length })
})

test('planThreadFollow judges expiry on real activity even when the capture is collapsed to today', () => {
  const t = thread({
    messages: [
      { date: '2026-08-12', path: 'time/2026/08/10-16/08-12/actions/messages/10-00_email_Jane-Doe_Atlas-kickoff.md' },
    ],
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
    messages: [
      { date: '2026-07-20', path: 'time/2026/07/20-26/07-20/actions/messages/09-00_email_Jane-Doe_Atlas-kickoff.md' },
    ],
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

test('planThreadFollow labels the follow with the thread summary when it has one', () => {
  const { follow, fileName } = plan(thread({ summary: 'Kickoff scheduling and open questions' }))

  assert({
    given: 'a summarized thread',
    should: 'label the follow with the summary, not the subject',
    expected: 'Kickoff scheduling and open questions',
    actual: follow.summary,
  })
  assert({
    given: 'a summarized thread',
    should: 'slug the file name from the summary',
    expected: '2026-08-12_email_Jane-Doe_Kickoff-scheduling-and-open-questions',
    actual: fileName,
  })
})

test('planThreadFollow takes the file name the fetch already stamped into captures', () => {
  const { fileName } = plan(
    thread({
      summary: 'Kickoff scheduling and open questions',
      followFile: '2026-08-11_email_Jane-Doe_Kickoff-scheduling-and-open-questions',
    }),
  )

  assert({
    given: 'captures already stamped with a follow name (dated a day earlier)',
    should: 'name the follow YAML identically — stamp and YAML must never drift',
    expected: '2026-08-11_email_Jane-Doe_Kickoff-scheduling-and-open-questions',
    actual: fileName,
  })
})

test('planThreadFollow falls back to the subject when the thread was not summarized', () => {
  const { follow, fileName } = plan(thread())

  assert({
    given: 'no summary',
    should: 'label the follow with the subject',
    expected: 'Atlas kickoff',
    actual: follow.summary,
  })
  assert({
    given: 'no summary',
    should: 'slug the file name from the subject',
    expected: '2026-08-12_email_Jane-Doe_Atlas-kickoff',
    actual: fileName,
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

test('uniqueFollowFileName keeps a free name as-is', async () => {
  const taken = new Set<string>()

  assert({
    given: 'a name no follow holds',
    should: 'return it unchanged and mark it minted',
    expected: '2026-08-14_email_Jane-Doe_Atlas-kickoff | minted: true',
    actual: `${await uniqueFollowFileName('2026-08-14_email_Jane-Doe_Atlas-kickoff', taken, async () => false)} | minted: ${taken.has('2026-08-14_email_Jane-Doe_Atlas-kickoff')}`,
  })
})

test('uniqueFollowFileName suffixes past names minted this run', async () => {
  const taken = new Set<string>()
  const mint = () => uniqueFollowFileName('2026-08-14_email_Jane-Doe_Atlas-kickoff', taken, async () => false)

  assert({
    given: 'three same-subject threads in one sync (the summarizer abstained on all)',
    should: 'give each its own follow — the second must never overwrite the first',
    expected:
      '2026-08-14_email_Jane-Doe_Atlas-kickoff, 2026-08-14_email_Jane-Doe_Atlas-kickoff-2, 2026-08-14_email_Jane-Doe_Atlas-kickoff-3',
    actual: [await mint(), await mint(), await mint()].join(', '),
  })
})

test('uniqueFollowFileName suffixes past follows already on disk', async () => {
  const onDisk = new Set(['2026-08-14_email_Jane-Doe_Atlas-kickoff', '2026-08-14_email_Jane-Doe_Atlas-kickoff-2'])

  assert({
    given: 'a name held by an existing follow (active or archived) and its -2',
    should: 'take the next free suffix',
    expected: '2026-08-14_email_Jane-Doe_Atlas-kickoff-3',
    actual: await uniqueFollowFileName('2026-08-14_email_Jane-Doe_Atlas-kickoff', new Set(), async (name) =>
      onDisk.has(name),
    ),
  })
})
