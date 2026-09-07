import type { OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import { createOutboxRoutes, type OutboxRoutesOptions } from './mod.ts'

function harness() {
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
  }
  return { app: createOutboxRoutes(host), actions }
}

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
