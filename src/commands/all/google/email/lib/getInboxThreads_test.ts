import { mkdtemp, rm } from 'node:fs/promises'
import { GoogleClient } from '#lib/google/client.ts'
import { saveAccountTokens } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
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
