import type {
  NeedsResponseClear,
  NeedsResponseHost,
  NeedsResponseItem,
  NeedsResponseList,
  ResponseScore,
} from '#lib/needsResponse/mod.ts'
import { assert, test } from '#test'
import { createNeedsResponseRoutes } from './needsResponse.ts'

const SCORE: ResponseScore = {
  today: { points: 180, replies: 2, quick: 1 },
  week: { points: 520, replies: 7 },
  days: [{ date: '2025-03-15', points: 180, replies: 2 }],
  waits: [1, 1, 0, 0, 0, 0],
}

function mockHost(initial: NeedsResponseItem[]) {
  let items = [...initial]
  const dismissed = new Set<string>()
  const cleared: NeedsResponseClear[] = []
  const opened: string[] = []
  let refreshed = 0

  const visible = () => items.filter((item) => !dismissed.has(item.id))
  const earned = () => cleared.filter((how) => how === 'responded').length * 100
  const list = (): NeedsResponseList => ({
    items: visible(),
    lastScanAt: '2025-03-15T16:00:00Z',
    todayPoints: earned(),
    weekPoints: earned(),
  })

  const host: NeedsResponseHost = {
    list: async () => list(),
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
    dismiss: async (id, _version, how = 'dismissed') => {
      dismissed.add(id)
      cleared.push(how)
      return list()
    },
    undismiss: async (id) => {
      dismissed.delete(id)
      return list()
    },
    score: async () => SCORE,
    openInApp: async (id) => {
      opened.push(id)
    },
    refreshIfStale: () => {},
  }
  return { host, opened, cleared, getRefreshed: () => refreshed }
}

const SAMPLE: NeedsResponseItem = {
  id: 'Beeper:imessage:!chat-1',
  version: 'v1',
  source: 'iMessage',
  kind: 'dm',
  sender: 'Jane Doe',
  summary: 'Are we still on for 3pm?',
  receivedAt: '2025-03-15T14:00:00Z',
  receivedLocal: '2025-03-15 14:00',
  ageHours: 2,
  points: 100,
  dropsInMinutes: 120,
  personScore: 400,
  priority: 10.5,
  href: null,
  openInApp: 'beeper',
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('needsResponse routes list, dismiss, undismiss, open Beeper chats, and enforce same-origin checks', async () => {
  const { host, opened } = mockHost([SAMPLE])
  const app = createNeedsResponseRoutes(host)

  const initial = (await (await app.request('/needs-response')).json()) as { items: NeedsResponseItem[] }

  const crossSite = await app.request(
    '/needs-response/dismiss',
    post({ id: SAMPLE.id, version: SAMPLE.version }, { 'sec-fetch-site': 'cross-site' }),
  )

  const afterDismiss = (await (
    await app.request('/needs-response/dismiss', post({ id: SAMPLE.id, version: SAMPLE.version }))
  ).json()) as { items: NeedsResponseItem[] }

  const afterUndo = (await (await app.request('/needs-response/undismiss', post({ id: SAMPLE.id }))).json()) as {
    items: NeedsResponseItem[]
  }

  const openRes = await app.request('/needs-response/open', post({ id: SAMPLE.id }))

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
      opened: [SAMPLE.id],
    },
  })
})

test('needsResponse routes tell a tick from the X and serve the response score', async () => {
  const { host, cleared } = mockHost([SAMPLE])
  const app = createNeedsResponseRoutes(host)

  const crossed = (await (
    await app.request('/needs-response/dismiss', post({ id: SAMPLE.id, version: SAMPLE.version }))
  ).json()) as NeedsResponseList
  const unknown = (await (
    await app.request('/needs-response/dismiss', post({ id: SAMPLE.id, version: SAMPLE.version, how: 'maybe' }))
  ).json()) as NeedsResponseList
  const ticked = (await (
    await app.request('/needs-response/dismiss', post({ id: SAMPLE.id, version: SAMPLE.version, how: 'responded' }))
  ).json()) as NeedsResponseList
  const score = await app.request('/needs-response/score')

  assert({
    given: 'a clear with no `how`, one with an unknown `how`, a tick, and a read of the score',
    should: 'treat everything but the tick as the X, report the points a tick earned, and return the score',
    actual: {
      cleared,
      points: [crossed.todayPoints, unknown.todayPoints, ticked.todayPoints],
      scoreStatus: score.status,
      score: await score.json(),
    },
    expected: {
      cleared: ['dismissed', 'dismissed', 'responded'],
      points: [0, 0, 100],
      scoreStatus: 200,
      score: SCORE,
    },
  })
})
