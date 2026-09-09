import type { OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import { holding } from '../../activity.ts'
import { createReloadGate, RELOAD_EXIT_CODE } from '../../reload.ts'
import { createOutboxRoutes, type OutboxRoutesOptions } from './mod.ts'

function harness(overrides: Partial<OutboxRoutesOptions> = {}) {
  const actions: string[] = []
  const item: OutboxRecord = {
    id: 'a'.repeat(32),
    revision: 'version',
    created: '2025-03-15 12:00',
    updated: '2025-03-15 12:00',
    status: 'needs_review',
    conversation: { key: 'sample', version: 'source-v1', medium: 'Slack', sources: [], target: null, limitations: [] },
    title: 'Confirm the update',
    situation: 'A direct request.',
    reasoning: 'A reply is needed.',
    questions: [],
    draft: 'Got it.',
    originalDraft: 'Got it.',
    edited: false,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
  }
  const host: OutboxRoutesOptions = {
    report: async () => ({ items: [], preferences: { text: '', revision: 'v1' }, automation: null, lastScan: null }),
    setup: async () => {
      actions.push('setup')
      return {}
    },
    scan: async () => {
      actions.push('scan')
      return { outcome: 'nothing', message: 'No new or changed conversations to check.' }
    },
    save: async () => {
      actions.push('save')
      return item
    },
    dismiss: async () => {
      actions.push('dismiss')
      return item
    },
    approve: async (_id: string, _revision: string, draft: string) => {
      actions.push(draft)
      return item
    },
    preferences: async () => {
      actions.push('preferences')
    },
    ...overrides,
  }
  return { app: createOutboxRoutes(host), actions }
}

test('Outbox check startup defers automatic reload until the worker handoff succeeds or fails', async () => {
  for (const fails of [false, true]) {
    const codes: number[] = []
    const gate = createReloadGate({
      root: '/nowhere',
      watch: false,
      exit: (code) => codes.push(code),
      log: { info: () => {}, warn: () => {} },
      debounceMs: 1,
      graceMs: 1,
    })
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish!: () => void
    const handoff = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { app } = harness({
      scan: async () => {
        entered()
        await handoff
        if (fails) throw new Error('Could not start the check worker.')
        return { outcome: 'nothing', running: true }
      },
    })
    const response = app.request('/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    try {
      await entering
      gate.request('source changed')
      await new Promise((resolve) => setTimeout(resolve, 20))
      const during = { exits: [...codes], held: holding().includes('outbox check startup') }
      finish()
      const accepted = await response
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert({
        given: fails
          ? 'worker startup fails while a reload is pending'
          : 'worker registration is pending during a source change',
        should: 'defer restart through handoff and always release it afterward',
        actual: [during, accepted.status, holding().includes('outbox check startup'), codes],
        expected: [{ exits: [], held: true }, fails ? 400 : 202, false, [RELOAD_EXIT_CODE]],
      })
    } finally {
      finish()
      await response
      gate.close()
    }
  }
})

test('Outbox routes require a same-origin explicit approval with nonempty revision', async () => {
  const { app, actions } = harness()
  const url = `/item/${'a'.repeat(32)}/approve`
  const body = JSON.stringify({ revision: 'v1', draft: 'Got it, thanks.' })
  const foreign = await app.request(url, {
    method: 'POST',
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
    body,
  })
  const form = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
  const invalid = await app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: 'Got it.' }),
  })
  const approved = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert({
    given: 'foreign, form, malformed, and explicit review requests',
    should: 'only hand the explicit valid approval to the native draft path',
    actual: { statuses: [foreign.status, form.status, invalid.status, approved.status], actions },
    expected: { statuses: [403, 400, 400, 200], actions: ['Got it, thanks.'] },
  })
})

test('Outbox reads never place drafts or enable automation', async () => {
  const { app, actions } = harness()
  const response = await app.request('/status')
  assert({
    given: 'opening the Outbox page',
    should: 'only read status',
    actual: [response.status, actions],
    expected: [200, []],
  })
})

test('Outbox Check now returns a quiet result instead of an empty success', async () => {
  const { app, actions } = harness()
  const response = await app.request('/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert({
    given: 'a check with no new messages',
    should: 'return the explanation for the browser to show',
    actual: { status: response.status, result: await response.json(), actions },
    expected: {
      status: 200,
      result: { outcome: 'nothing', message: 'No new or changed conversations to check.' },
      actions: ['scan'],
    },
  })
})

test('Outbox validates the selected dates, times, and range revision before starting a check', async () => {
  const { app, actions } = harness()
  const valid = { start: '2025-03-14T08:30', end: '2025-03-15T17:45' }
  const requests = [
    { range: { ...valid, start: '2025-02-30T08:30' }, revision: 'v1' },
    { range: { start: valid.end, end: valid.start }, revision: 'v1' },
    { range: valid },
    { range: valid, revision: 'v1' },
  ]
  const statuses: number[] = []
  for (const data of requests)
    statuses.push(
      (
        await app.request('/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      ).status,
    )
  assert({
    given: 'invalid, reversed, unversioned, and valid selected ranges',
    should: 'start only the valid revisioned request',
    actual: [statuses, actions],
    expected: [[400, 400, 400, 200], ['scan']],
  })
})
