import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GoogleClient } from '#lib/google/client.ts'
import { ensureLabel, threadIdToDecimal } from '#lib/google/gmail.ts'
import { saveAccountTokens } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { Instant, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { backfillArchivedFollows } from './backfillArchivedFollows.ts'
import { archivedLabelName, retireGmailThread } from './followLabels.ts'
import {
  continueFollow,
  expireQuietFollows,
  persistNewFollow,
  planThreadFollow,
  resumeLabeledFollows,
} from './followLifecycle.ts'
import { getInboxThreads } from './getInboxThreads.ts'

const NOW = PlainDateTime.fromString('2025-04-22 12:00')
const EARLIER = PlainDateTime.fromString('2025-04-01 09:00')
const EMAIL = 'jane@example.com'
const LABEL = 'Sky/Follow'
const output = { log: (_message: string) => {} }
type WireMessage = { id: string; threadId: string; labelIds: string[]; internalDate: string }

function message(threadId: string, id: string, at: string, labelIds: string[]): WireMessage {
  return { id, threadId, labelIds, internalDate: String(Instant.from(at).epochMilliseconds) }
}

function savedFollow(id = 'ff', status: 'active' | 'closed' = 'closed', account = EMAIL): Follow {
  return Follow.create({
    source: 'Email',
    ref: { account, threadId: threadIdToDecimal(id), label: LABEL },
    summary: 'Atlas planning',
    followSince: EARLIER,
    lastActivity: EARLIER,
    status,
    messages: [{ date: '2025-04-01', path: '2025-04-01/actions/messages/09-00_email_Jane-Doe_Atlas-planning.md' }],
  })
}

async function withArchive(
  run: (h: {
    client: GoogleClient
    activeDir: string
    archiveDir: string
    timeDir: string
    labels: { id: string; name: string; type: string }[]
    threads: Map<string, WireMessage[]>
    writes: { id: string; addLabelIds: string[]; removeLabelIds: string[] }[]
    fail: Set<string>
    quotaFailures: Map<string, number>
    save: (name: string, follow: Follow) => Promise<void>
    registry: () => Promise<EmailFollowRegistry>
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp('/tmp/sky-follow-archive-test-')
  const activeDir = path.join(root, 'active')
  const archiveDir = path.join(root, 'archive')
  const timeDir = path.join(root, 'time')
  const labels = [
    { id: 'follow', name: LABEL, type: 'user' },
    { id: 'now', name: `${LABEL}/Now`, type: 'user' },
    { id: 'INBOX', name: 'INBOX', type: 'system' },
  ]
  const threads = new Map<string, WireMessage[]>()
  const writes: { id: string; addLabelIds: string[]; removeLabelIds: string[] }[] = []
  const fail = new Set<string>()
  const quotaFailures = new Map<string, number>()
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, EMAIL, { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const client = new GoogleClient({
    secrets,
    email: EMAIL,
    client: { clientId: 'id', clientSecret: 'secret' },
    fetchFn: (async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      const route = url.pathname
      let body: unknown
      if (route.endsWith('/labels')) {
        if (init?.method === 'POST') {
          const created = { id: 'archived', name: JSON.parse(String(init.body)).name, type: 'user' }
          labels.push(created)
          body = created
        } else body = { labels }
      } else if (route.endsWith('/threads')) {
        body = {
          threads: [...threads]
            .filter(([, messages]) => messages.some((m) => m.labelIds.includes(url.searchParams.get('labelIds') ?? '')))
            .map(([id]) => ({ id })),
        }
      } else {
        const match = route.match(/\/threads\/([^/]+)(\/modify)?$/)
        if (!match) throw new Error(`Unexpected request ${route}`)
        const id = match[1]
        const messages = threads.get(id)
        if (!messages) return new Response('{}', { status: 404 })
        const limited = quotaFailures.get(id) ?? 0
        if (limited > 0) {
          quotaFailures.set(id, limited - 1)
          return new Response(JSON.stringify({ error: { message: 'User rate limit exceeded' } }), { status: 403 })
        }
        if (match[2]) {
          if (fail.has(id)) return new Response('{}', { status: 400 })
          const change = JSON.parse(String(init?.body))
          writes.push({ id, ...change })
          for (const m of messages)
            m.labelIds = [...new Set([...m.labelIds, ...change.addLabelIds])].filter(
              (labelId) => !change.removeLabelIds.includes(labelId),
            )
        }
        body = { messages }
      }
      return new Response(JSON.stringify(body))
    }) as typeof fetch,
  })
  try {
    await mkdir(activeDir)
    await mkdir(archiveDir)
    const day = path.join(timeDir, dayFile('2025-04-01'))
    await mkdir(path.dirname(day), { recursive: true })
    await writeFile(day, '---\ntz: UTC\n---\n\n# **2025-04-01**\n')
    await run({
      client,
      activeDir,
      archiveDir,
      timeDir,
      labels,
      threads,
      writes,
      fail,
      quotaFailures,
      save: (name, follow) =>
        writeFile(path.join(follow.status === 'closed' ? archiveDir : activeDir, `${name}.yaml`), follow.toYaml()),
      registry: () => EmailFollowRegistry.buildWithArchive(activeDir, archiveDir),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('closing saved history swaps labels together and leaves unsaved threads unmarked', async () => {
  await withArchive(async (h) => {
    h.threads.set('ff', [message('ff', 'a1', '2025-04-01T09:00:00Z', ['follow', 'now', 'INBOX', 'UNREAD'])])
    await retireGmailThread({ client: h.client, threadId: 'ff', label: LABEL, saved: true })
    assert({
      given: 'a saved thread carrying both entry labels',
      should: 'swap to Archived and preserve unread status',
      actual: h.threads.get('ff')?.[0].labelIds,
      expected: ['UNREAD', 'archived'],
    })
    assert({ given: 'one closure', should: 'make a single thread update', actual: h.writes.length, expected: 1 })
    h.threads.set('fe', [message('fe', 'a2', '2025-04-01T09:00:00Z', ['follow', 'INBOX'])])
    await retireGmailThread({ client: h.client, threadId: 'fe', label: LABEL, saved: false })
    assert({
      given: 'an unsaved thread',
      should: 'leave no false archive marker',
      actual: h.threads.get('fe')?.[0].labelIds,
      expected: [],
    })
    assert({
      given: 'default and custom follow buckets',
      should: 'name separate history labels',
      actual: [archivedLabelName(LABEL), archivedLabelName('Atlas')],
      expected: ['Sky/Archived', 'Atlas/Archived'],
    })
  })
})

test('expiry archives only after Gmail succeeds, and retries a failed closure', async () => {
  await withArchive(async (h) => {
    await h.save('atlas', savedFollow('ff', 'active'))
    h.threads.set('ff', [message('ff', 'a1', '2025-04-01T09:00:00Z', ['follow'])])
    h.fail.add('ff')
    const sweep = async () =>
      expireQuietFollows({
        client: h.client,
        entries: (await h.registry()).getActive(),
        fallbackLabel: LABEL,
        now: NOW,
        output,
        archiveDir: h.archiveDir,
      })
    const failed = await sweep()
    assert({
      given: 'Gmail rejects the archive-label swap',
      should: 'retain an active follow for retry',
      actual: [failed.skipped, (await h.registry()).findByThreadId('255', EMAIL)?.follow.status],
      expected: [['atlas'], 'active'],
    })
    h.fail.clear()
    await sweep()
    assert({
      given: 'the retry succeeds',
      should: 'keep both the closed record and Gmail marker',
      actual: [(await h.registry()).findByThreadId('255', EMAIL)?.follow.status, h.threads.get('ff')?.[0].labelIds],
      expected: ['closed', ['archived']],
    })
  })
})

test('a first capture already past expiry receives the archive marker', async () => {
  await withArchive(async (h) => {
    h.threads.set('ff', [message('ff', 'a1', '2025-04-01T09:00:00Z', ['follow', 'INBOX'])])
    const planned = planThreadFollow({
      accountEmail: EMAIL,
      label: LABEL,
      now: NOW,
      thread: {
        threadId: '255',
        from: 'Jane Doe',
        subject: 'Atlas planning',
        followFile: 'atlas',
        captured: 1,
        lastMessageAt: EARLIER.toString(),
        messages: savedFollow().messages,
      },
    })
    const result = await persistNewFollow({
      client: h.client,
      labelId: 'follow',
      planned,
      output,
      activeDir: h.activeDir,
      archiveDir: h.archiveDir,
    })
    assert({
      given: 'a successful capture of an old thread',
      should: 'persist it closed and label its history',
      actual: [
        result.followed,
        (await h.registry()).findByThreadId('255', EMAIL)?.follow.status,
        h.threads.get('ff')?.[0].labelIds,
      ],
      expected: [false, 'closed', ['archived']],
    })
  })
})

test('late replies keep their archived history, and explicit re-follow resumes without recapture', async () => {
  await withArchive(async (h) => {
    await h.save('atlas', savedFollow())
    // Another account may use the same Gmail thread id; its newer cutoff must not hide our reply.
    await h.save('foreign', savedFollow('ff', 'active', 'other@example.com').updateLastActivity(NOW))
    const archived = await ensureLabel(h.client, 'Sky/Archived')
    h.threads.set('ff', [
      message('ff', 'a1', '2025-04-01T09:00:20Z', [archived.id]),
      message('ff', 'a2', '2025-04-22T11:30:00Z', ['INBOX', 'UNREAD']),
    ])
    const options = { followDir: h.activeDir, followArchiveDir: h.archiveDir, timeDir: h.timeDir, syncLabels: false }
    const inbox = await getInboxThreads(h.client, 'INBOX', options)
    assert({
      given: 'an archived conversation with a late inbox reply',
      should: 'recognize only the earlier message as saved without reopening it',
      actual: [inbox.threads[0].followStatus, inbox.threads[0].messages.map((m) => m.saved), h.writes.length],
      expected: ['closed', [true, false], 0],
    })
    h.threads.get('ff')![1].labelIds.push('now')
    const picked = await getInboxThreads(h.client, `${LABEL}/Now`, options)
    await resumeLabeledFollows({
      client: h.client,
      threads: picked.threads,
      label: LABEL,
      labelId: 'follow',
      now: NOW,
      output,
      activeDir: h.activeDir,
      archiveDir: h.archiveDir,
    })
    const entry = (await h.registry()).findByThreadId('255', EMAIL)!
    assert({
      given: 'an explicit re-follow through Now',
      should: 'preserve identity, history and cutoff, reset the watch, and leave the reply in the inbox',
      actual: [
        entry.fileName,
        entry.follow.status,
        entry.follow.followSince?.toString(),
        entry.follow.lastActivity?.toString(),
        entry.follow.messages,
        entry.follow.isExpired(NOW),
        h.threads.get('ff')![1].labelIds.includes('INBOX'),
        h.threads.get('ff')![0].labelIds.includes('archived'),
      ],
      expected: ['atlas', 'active', EARLIER.toString(), EARLIER.toString(), savedFollow().messages, false, true, false],
    })
    const resumed = await getInboxThreads(h.client, LABEL, options)
    assert({
      given: 'the resumed watch',
      should: 'still capture only the late reply',
      actual: resumed.threads[0].messages.map((m) => m.saved),
      expected: [true, false],
    })
    assert({
      given: 'a resumed watch with no further activity',
      should: 'expire after its fresh 14-day window',
      actual: entry.follow.isExpired(PlainDateTime.fromString('2025-05-06 12:00')),
      expected: true,
    })
    const extended = continueFollow(
      entry.follow,
      {
        threadId: '255',
        from: 'Jane Doe',
        subject: 'Atlas planning',
        captured: 1,
        lastMessageAt: '2025-04-22 11:30',
        messages: [{ date: '2025-04-22', path: '2025-04-22/actions/messages/11-30_email_Jane-Doe_Atlas-planning.md' }],
      },
      NOW,
    )
    assert({
      given: 'capturing the reply after resumption',
      should: 'append to the original capture history',
      actual: extended.messages.length,
      expected: 2,
    })
  })
})

test('a failed resume retains archived history and can retry without new messages', async () => {
  await withArchive(async (h) => {
    await h.save('atlas', savedFollow())
    h.threads.set('ff', [message('ff', 'a1', '2025-04-01T09:00:20Z', ['follow'])])
    const options = { followDir: h.activeDir, followArchiveDir: h.archiveDir, timeDir: h.timeDir, syncLabels: false }
    const listed = await getInboxThreads(h.client, LABEL, options)
    const resume = () =>
      resumeLabeledFollows({
        client: h.client,
        threads: listed.threads,
        label: LABEL,
        labelId: 'follow',
        now: NOW,
        output,
        activeDir: h.activeDir,
        archiveDir: h.archiveDir,
      })
    h.fail.add('ff')
    let failed = false
    try {
      await resume()
    } catch {
      failed = true
    }
    assert({
      given: 'Gmail rejects resumption',
      should: 'leave the closed record intact',
      actual: [failed, Follow.fromYaml(await readFile(path.join(h.archiveDir, 'atlas.yaml'), 'utf8')).status],
      expected: [true, 'closed'],
    })
    h.fail.clear()
    assert({
      given: 'a retry with all messages already captured',
      should: 'resume the watch anyway',
      actual: await resume(),
      expected: 1,
    })
  })
})

test('backfill previews, skips current watches, preserves inbox state, and is repeatable', async () => {
  await withArchive(async (h) => {
    await h.save('atlas', savedFollow())
    await h.save('queued', savedFollow('fe'))
    await h.save('active-archive', savedFollow('fd'))
    await h.save('active', savedFollow('fd', 'active'))
    await h.save('foreign', savedFollow('fc', 'closed', 'other@example.com'))
    await h.save('missing', savedFollow('fb'))
    h.threads.set('ff', [message('ff', 'a1', '2025-04-22T11:30:00Z', ['INBOX', 'UNREAD'])])
    h.threads.set('fe', [message('fe', 'a2', '2025-04-22T11:30:00Z', ['now', 'INBOX'])])
    const registry = await h.registry()
    const sleep = async (_ms: number) => {}
    const preview = await backfillArchivedFollows({ client: h.client, registry, label: LABEL, apply: false, sleep })
    assert({
      given: 'old, queued, active, foreign, and missing threads',
      should: 'preview only the eligible thread without creating a label',
      actual: [
        preview.wouldLabel,
        preview.skipped,
        preview.errors,
        h.labels.some((l) => l.name === 'Sky/Archived'),
        h.writes.length,
      ],
      expected: [1, 3, [], false, 0],
    })
    const applied = await backfillArchivedFollows({ client: h.client, registry, label: LABEL, apply: true, sleep })
    const repeated = await backfillArchivedFollows({ client: h.client, registry, label: LABEL, apply: true, sleep })
    assert({
      given: 'the backfill applied twice',
      should: 'label once and leave the late reply unread in the inbox',
      actual: [applied.labeled, repeated.labeled, repeated.alreadyLabeled, h.threads.get('ff')![0].labelIds, h.writes],
      expected: [
        1,
        0,
        1,
        ['INBOX', 'UNREAD', 'archived'],
        [{ id: 'ff', addLabelIds: ['archived'], removeLabelIds: [] }],
      ],
    })
  })
})

test('backfill retries Gmail quota errors and stops a persistently throttled pass', async () => {
  await withArchive(async (h) => {
    await h.save('atlas', savedFollow())
    h.threads.set('ff', [message('ff', 'a1', '2025-04-22T11:30:00Z', ['INBOX'])])
    const pauses: number[] = []
    const sleep = async (ms: number) => {
      pauses.push(ms)
    }
    h.quotaFailures.set('ff', 2)
    const registry = await h.registry()
    const repaired = await backfillArchivedFollows({ client: h.client, registry, label: LABEL, apply: true, sleep })
    assert({
      given: 'two temporary per-user quota errors',
      should: 'back off and finish the same thread',
      actual: [repaired.labeled, repaired.errors, pauses.filter((ms) => ms > 250)],
      expected: [1, [], [5000, 10000]],
    })
    h.quotaFailures.set('ff', 10)
    const limited = await backfillArchivedFollows({ client: h.client, registry, label: LABEL, apply: true, sleep })
    assert({
      given: 'a quota that does not recover',
      should: 'return a partial result after bounded retries',
      actual: [limited.labeled, limited.errors.length, h.quotaFailures.get('ff')],
      expected: [0, 1, 4],
    })
  })
})
