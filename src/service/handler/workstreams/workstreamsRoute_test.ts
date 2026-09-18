import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, type WorkstreamRecord } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-route-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const app = createWorkstreamRoutes({
    store,
    now: () => NOW,
    today: () => NOW.slice(0, 10),
    automation: async () => null,
    setup: async () => ({}),
    draft: async () => ({ title: 'Atlas pilot' }),
    run: async (id) => ({
      id: 'run',
      workstreamId: id,
      status: 'nothing',
      trigger: 'manual',
      started: NOW,
      summary: '',
      artifactIds: [],
    }),
    planDay: async (id) => (await store.get(id))!,
  })
  const request = (url: string, data: unknown, method = 'POST', origin?: string) =>
    app.request(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(data),
    })
  return { root, store, app, request, clean: () => rm(root, { recursive: true, force: true }) }
}

test('partial workstream edits retain activities and layout never changes a work revision', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      {
        title: 'Atlas',
        outcome: 'Agree scope',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Prepare scope' })],
      },
      NOW,
    )
    const response = await f.request(`/${work.id}`, { revision: work.revision, patch: { title: 'Atlas pilot' } }, 'PUT')
    const updated = (await response.json()) as WorkstreamRecord
    await f.request('/layout', { id: work.id, x: 0, y: 0, order: -1 }, 'PUT')
    const positioned = await f.request('/layout', { id: work.id, x: 120, y: -80 }, 'PUT')
    const after = (await f.store.get(work.id))!
    const report = await (await f.app.request('/status')).json()
    assert({
      given: 'a title-only edit and a Map move',
      should: 'retain other work and keep positioning out of the work revision',
      actual: [
        response.status,
        updated.outcome,
        updated.activities.length,
        positioned.status,
        after.revision === updated.revision,
        report.layout[work.id],
      ],
      expected: [200, 'Agree scope', 1, 200, true, { x: 120, y: -80, order: -1 }],
    })
  } finally {
    await f.clean()
  }
})

test('a context update can be retried after a lost response without duplicating notes or overwriting later changes', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas', notes: 'Initial intention.' }, NOW)
    const request = { revision: work.revision, text: '  The pilot scope is approved.\n', operationId: 'context-update' }
    const first = await f.request(`/${work.id}/context`, request)
    const saved = (await f.store.get(work.id))!
    const later = await f.store.put({ ...saved, outcome: 'Complete the smaller pilot.' }, saved.revision)
    const retried = await f.request(`/${work.id}/context`, { ...request, text: request.text.trim() })
    const replay = (await retried.json()) as WorkstreamRecord
    const conflict = await f.request(`/${work.id}/context`, {
      ...request,
      revision: later.revision,
      text: 'The scope is rejected.',
    })
    const staleNew = await f.request(`/${work.id}/context`, { ...request, operationId: 'another-update' })
    const legacyStale = await f.request(`/${work.id}/context`, { revision: work.revision, text: request.text })
    const current = (await f.store.get(work.id))!
    assert({
      given: 'an acknowledged operation with a lost response, a later edit, and retries with the original revision',
      should:
        'return the latest work for the same operation and text while rejecting altered operations and unrelated stale writes',
      actual: [
        first.status,
        retried.status,
        replay.revision === later.revision,
        replay.outcome,
        conflict.status,
        staleNew.status,
        legacyStale.status,
        current.revision === later.revision,
        current.notes.trim(),
        current.history
          .filter((entry) => entry.kind === 'context')
          .map(({ operationId, summary }) => ({ operationId, summary })),
      ],
      expected: [
        200,
        200,
        true,
        'Complete the smaller pilot.',
        409,
        409,
        409,
        true,
        'Initial intention.\n\nThe pilot scope is approved.',
        [{ operationId: 'context-update', summary: 'The pilot scope is approved.' }],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('concurrent retries of one context update append the note once', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas' }, NOW)
    const request = { revision: work.revision, text: 'Support is ready.', operationId: 'same-update' }
    const responses = await Promise.all([
      f.request(`/${work.id}/context`, request),
      f.request(`/${work.id}/context`, request),
    ])
    const saved = (await f.store.get(work.id))!
    assert({
      given: 'two simultaneous deliveries of the same context operation',
      should: 'acknowledge both while persisting only one note and history event',
      actual: [
        responses.map((response) => response.status),
        saved.notes.trim(),
        saved.history.filter((entry) => entry.operationId === request.operationId).length,
      ],
      expected: [[200, 200], 'Support is ready.', 1],
    })
  } finally {
    await f.clean()
  }
})

test('workstream routes reject foreign writes and stale resolutions', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      { title: 'Atlas', activities: [ActivitySchema.parse({ id: 'choose', title: 'Choose scope', kind: 'decision' })] },
      NOW,
    )
    const foreign = await f.request('/create', { title: 'Uninvited work' }, 'POST', 'https://example.com')
    const bad = await f.request(`/${work.id}/activities/choose/resolve`, { revision: 'stale', result: 'Small scope' })
    const good = await f.request(`/${work.id}/activities/choose/resolve`, {
      revision: work.revision,
      result: 'Small scope',
    })
    assert({
      given: 'a foreign origin, an old revision and a valid decision',
      should: 'write only the explicitly submitted current decision',
      actual: [foreign.status, bad.status, good.status, (await f.store.get(work.id))!.activities[0].result],
      expected: [403, 409, 200, 'Small scope'],
    })
  } finally {
    await f.clean()
  }
})

test('promoting an activity is recoverable and preserves its identity and daily references', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      {
        title: 'Atlas pilot',
        activities: [
          ActivitySchema.parse({
            id: 'scope',
            title: 'Agree scope',
            participation: [{ day: '2025-03-15', title: 'Agree scope', state: 'ready' }],
          }),
        ],
      },
      NOW,
    )
    const response = await f.request(`/${work.id}/activities/scope/promote`, { revision: work.revision })
    const result = (await response.json()) as { parent: WorkstreamRecord; child: WorkstreamRecord }
    const again = await f.request(`/${work.id}/activities/scope/promote`, { revision: result.parent.revision })
    assert({
      given: 'an activity with daily participation expanded into its own workstream twice',
      should: 'reuse one child while retaining the old activity reference and history',
      actual: [
        response.status,
        again.status,
        (await f.store.list()).length,
        result.parent.activities[0].id,
        result.parent.activities[0].participation.length,
        result.child.parentId,
      ],
      expected: [200, 200, 2, 'scope', 1, work.id],
    })
  } finally {
    await f.clean()
  }
})
