import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { GoogleClient } from '#lib/google/client.ts'
import { threadIdToDecimal } from '#lib/google/gmail.ts'
import { saveAccountTokens } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { getInboxThreads, savedByCutoff } from './getInboxThreads.ts'

const CUTOFF = new Date('2026-08-10T10:15:00')

test('savedByCutoff counts the whole cutoff minute as saved', () => {
  assert({
    given: 'a message before the cutoff',
    should: 'count as saved',
    expected: true,
    actual: savedByCutoff(new Date('2026-08-10T09:00:00'), CUTOFF),
  })
  assert({
    given: 'a message 42s into the cutoff minute (the one that set lastActivity)',
    should: 'count as saved',
    expected: true,
    actual: savedByCutoff(new Date('2026-08-10T10:15:42'), CUTOFF),
  })
  assert({
    given: 'a message in the next minute',
    should: 'count as unsaved',
    expected: false,
    actual: savedByCutoff(new Date('2026-08-10T10:16:00'), CUTOFF),
  })
})

test('getInboxThreads only synchronizes user labels when requested', async () => {
  const followDir = await mkdtemp('/tmp/sky-gmail-follow-test-')
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  try {
    for (const label of [
      { id: 'Label_7', name: 'Sky/Follow', type: 'user' },
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'UNREAD', name: 'UNREAD', type: 'system' },
    ]) {
      for (const syncLabels of [undefined, false, true]) {
        const writes: unknown[] = []
        const client = new GoogleClient({
          secrets,
          email: 'jane@example.com',
          client: { clientId: 'id', clientSecret: 'secret' },
          fetchFn: (async (input: unknown, init?: RequestInit) => {
            const path = new URL(String(input)).pathname
            let body: unknown
            if (path.endsWith('/labels')) body = { labels: [label] }
            else if (path.endsWith('/threads')) body = { threads: [{ id: 'ff' }] }
            else if (path.endsWith('/threads/ff')) {
              body = {
                messages: [
                  { id: 'a1', threadId: 'ff', labelIds: [label.id] },
                  { id: 'a2', threadId: 'ff', labelIds: [] },
                ],
              }
            } else if (path.endsWith('/threads/ff/modify') && init?.method === 'POST') {
              writes.push(JSON.parse(String(init.body)))
              body = {}
            } else throw new Error(`Unexpected Gmail request: ${path}`)
            return new Response(JSON.stringify(body))
          }) as typeof fetch,
        })

        const result = await getInboxThreads(client, label.name, { syncLabels, followDir })
        assert({
          given: `${label.name} with label synchronization ${String(syncLabels)}`,
          should: 'label new replies only for user buckets when synchronization is enabled',
          expected: {
            writes:
              label.type === 'user' && syncLabels !== false ? [{ addLabelIds: [label.id], removeLabelIds: [] }] : [],
            messages: 2,
            unsaved: 1,
          },
          actual: { writes, messages: result.threads[0].messages.length, unsaved: result.unsavedCount },
        })
      }
    }
  } finally {
    await rm(followDir, { recursive: true, force: true })
  }
})

test('getInboxThreads reads a follow’s last activity in the zone of its day', async () => {
  const followDir = await mkdtemp('/tmp/sky-gmail-follow-test-')
  const timeDir = await mkdtemp('/tmp/sky-gmail-time-test-')
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  try {
    // The follow says 14:34 on a day kept away from any test machine's zone:
    // the message that set it arrived 20s into that minute, a reply 30 minutes on.
    for (const { tz, stamped } of [
      { tz: 'Pacific/Honolulu', stamped: Date.UTC(2026, 5, 16, 0, 34, 20) },
      { tz: 'Asia/Tokyo', stamped: Date.UTC(2026, 5, 15, 5, 34, 20) },
    ]) {
      const dayPath = path.join(timeDir, dayFile('2026-06-15'))
      await mkdir(path.dirname(dayPath), { recursive: true })
      await writeFile(dayPath, `---\ntz: ${tz}\n---\n\n# **2026-06-15**\n`)
      const follow = Follow.create({
        source: 'Email',
        ref: { account: 'jane@example.com', threadId: threadIdToDecimal('ff'), label: 'Sky/Follow' },
        summary: 'Atlas kickoff',
        followSince: PlainDateTime.fromString('2026-06-14 09:00'),
        lastActivity: PlainDateTime.fromString('2026-06-15 14:34'),
        messages: [],
        status: 'active',
      })
      await writeFile(path.join(followDir, 'atlas-kickoff.yaml'), follow.toYaml())

      const client = new GoogleClient({
        secrets,
        email: 'jane@example.com',
        client: { clientId: 'id', clientSecret: 'secret' },
        fetchFn: (async (input: unknown) => {
          const route = new URL(String(input)).pathname
          let body: unknown
          if (route.endsWith('/labels')) body = { labels: [{ id: 'Label_7', name: 'Sky/Follow', type: 'user' }] }
          else if (route.endsWith('/threads')) body = { threads: [{ id: 'ff' }] }
          else if (route.endsWith('/threads/ff')) {
            body = {
              messages: [
                { id: 'a1', threadId: 'ff', labelIds: ['Label_7'], internalDate: String(stamped) },
                { id: 'a2', threadId: 'ff', labelIds: ['Label_7'], internalDate: String(stamped + 30 * 60_000) },
              ],
            }
          } else throw new Error(`Unexpected Gmail request: ${route}`)
          return new Response(JSON.stringify(body))
        }) as typeof fetch,
      })

      const result = await getInboxThreads(client, 'Sky/Follow', { syncLabels: false, followDir, timeDir })
      assert({
        given: `a follow last active at 14:34 on a day kept in ${tz}`,
        should: 'count the message that set it as saved, and the reply half an hour later as new',
        expected: [true, false],
        actual: result.threads[0].messages.map((message) => message.saved),
      })
    }
  } finally {
    await rm(followDir, { recursive: true, force: true })
    await rm(timeDir, { recursive: true, force: true })
  }
})
