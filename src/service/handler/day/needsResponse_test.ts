import type { NeedsResponseHost, NeedsResponseItem } from '#lib/needsResponse/mod.ts'
import { assert, test } from '#test'
import { createNeedsResponseRoutes } from './needsResponse.ts'

function mockHost(initial: NeedsResponseItem[]) {
  let items = [...initial]
  const dismissed = new Set<string>()
  const opened: string[] = []
  let refreshed = 0

  const visible = () => items.filter((item) => !dismissed.has(item.id))

  const host: NeedsResponseHost = {
    list: async () => ({ items: visible(), lastScanAt: '2025-03-15T16:00:00Z' }),
    scan: async () => {
      refreshed++
      return {
        scannedAt: '2025-03-15T16:00:00Z',
        capturesFound: items.length,
        gmailThreadsChecked: 0,
        screened: 0,
        active: items.length,
        errors: [],
      }
    },
    dismiss: async (id) => {
      dismissed.add(id)
      return { items: visible(), lastScanAt: '2025-03-15T16:00:00Z' }
    },
    undismiss: async (id) => {
      dismissed.delete(id)
      return { items: visible(), lastScanAt: '2025-03-15T16:00:00Z' }
    },
    openInApp: async (id) => {
      opened.push(id)
    },
    refreshIfStale: () => {},
  }
  return { host, opened, getRefreshed: () => refreshed }
}

test('needsResponse routes list, dismiss, undismiss, open Beeper chats, and enforce same-origin checks', async () => {
  const sample: NeedsResponseItem = {
    id: 'Beeper:imessage:!chat-1',
    version: 'v1',
    source: 'iMessage',
    kind: 'dm',
    sender: 'Jane Doe',
    summary: 'Are we still on for 3pm?',
    receivedAt: '2025-03-15T14:00:00Z',
    receivedLocal: '2025-03-15 14:00',
    ageHours: 2,
    personScore: 400,
    priority: 10.5,
    href: null,
    openInApp: 'beeper',
  }
  const { host, opened } = mockHost([sample])
  const app = createNeedsResponseRoutes(host)

  const initial = (await (await app.request('/needs-response')).json()) as { items: NeedsResponseItem[] }

  const crossSite = await app.request('/needs-response/dismiss', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ id: sample.id, version: sample.version }),
  })

  const afterDismiss = (await (
    await app.request('/needs-response/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: sample.id, version: sample.version }),
    })
  ).json()) as { items: NeedsResponseItem[] }

  const afterUndo = (await (
    await app.request('/needs-response/undismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: sample.id }),
    })
  ).json()) as { items: NeedsResponseItem[] }

  const openRes = await app.request('/needs-response/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: sample.id }),
  })

  assert({
    given: 'GET, cross-site POST, dismiss, undismiss, and Beeper open requests',
    should: 'enforce CSRF, clear and restore cleanly, and trigger Beeper open',
    actual: {
      initialCount: initial.items.length,
      crossSiteStatus: crossSite.status,
      afterDismissCount: afterDismiss.items.length,
      afterUndoCount: afterUndo.items.length,
      openStatus: openRes.status,
      opened,
    },
    expected: {
      initialCount: 1,
      crossSiteStatus: 403,
      afterDismissCount: 0,
      afterUndoCount: 1,
      openStatus: 200,
      opened: [sample.id],
    },
  })
})
