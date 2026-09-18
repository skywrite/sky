import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, SkySchema, WorkstreamError, type WorkstreamRecord } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:08'
const LOCAL = '2025-03-15 07:08:09'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-identities-route-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  let now = NOW
  let local = LOCAL
  let setupCalls = 0
  const app = createWorkstreamRoutes({
    store,
    now: () => now,
    identityTime: () => local,
    today: () => now.slice(0, 10),
    automation: async () => null,
    setup: async () => {
      setupCalls++
      return {}
    },
    draft: async () => ({}),
    run: async (id) => ({
      id: 'run',
      workstreamId: id,
      status: 'nothing',
      trigger: 'manual',
      started: now,
      summary: '',
      artifactIds: [],
    }),
    planDay: async (id) => (await store.get(id))!,
  })
  const request = (url: string, body: unknown) =>
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return {
    store,
    request,
    setupCalls: () => setupCalls,
    advance: () => {
      now = '2025-03-16 15:20'
      local = '2025-03-16 10:20:31'
    },
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

function interruptNextWrite(store: WorkstreamStore, id: string): void {
  const put = store.put.bind(store)
  let interrupt = true
  store.put = async (work, revision) => {
    if (work.id === id && interrupt) {
      interrupt = false
      throw new WorkstreamError('Interrupted before the parent update.', 503)
    }
    return put(work, revision)
  }
}

test('capture uses local seconds and readable names while retries preserve later edits and revoked Sky responsibility', async () => {
  const f = await fixture()
  try {
    const body = {
      requestId: 'capture-atlas',
      title: 'Prepare Atlas Partner Pilot Launch Materials Together',
      outcome: 'Agree a useful pilot.',
      sky: { mode: 'assist' },
    }
    const response = await f.request('/create', body)
    const created = (await response.json()) as WorkstreamRecord
    const renamed = await f.store.put({ ...created, title: 'A revised pilot outcome' }, created.revision)
    const current = await f.store.configureSky(renamed.id, SkySchema.parse({ mode: 'off' }), renamed.revision)
    f.advance()
    const retry = await f.request('/create', body)
    const replay = (await retry.json()) as WorkstreamRecord
    assert({
      given: 'a retried capture after the work was renamed, its Sky help stopped, and the creation clock changed',
      should: 'retain the original readable identity and current work without rerunning setup or restoring authority',
      actual: [
        response.status,
        created.id,
        created.path,
        created.created,
        retry.status,
        replay.id,
        replay.title,
        replay.revision === current.revision,
        replay.sky.mode,
        f.setupCalls(),
        (await f.store.list()).length,
      ],
      expected: [
        201,
        '2025-03-15_07-08-09_Prepare-Atlas-Partner-Pilot-Launch-Materials',
        'workstreams/2025-03-15_07-08-09_Prepare-Atlas-Partner-Pilot-Launch-Materials/workstream.md',
        NOW,
        200,
        created.id,
        'A revised pilot outcome',
        true,
        'off',
        1,
        1,
      ],
    })
    await f.store.delete(current.id, current.revision)
    const deletedRetry = await f.request('/create', body)
    const report = await f.store.report()
    assert({
      given: 'the same capture operation after its workstream was deleted',
      should: 'reject recreation while retaining the one recoverable deletion and leaving Sky off',
      actual: [deletedRetry.status, report.items.length, report.deleted.map((item) => item.id), f.setupCalls()],
      expected: [409, 0, [created.id], 1],
    })
  } finally {
    await f.clean()
  }
})

test('concurrent capture retries create one readable workstream and configure Sky once', async () => {
  const f = await fixture()
  try {
    const body = { requestId: 'same-capture', title: 'Prepare Atlas Partner Launch Plan', sky: { mode: 'assist' } }
    const responses = await Promise.all([f.request('/create', body), f.request('/create', body)])
    const work = await Promise.all(responses.map(async (response) => (await response.json()) as WorkstreamRecord))
    assert({
      given: 'the same capture request delivered twice at once with initial Sky help requested',
      should: 'acknowledge both requests with one workstream identity and one authority setup',
      actual: [
        responses.map((response) => response.status).sort(),
        work.map((item) => item.id),
        work.map((item) => item.sky.mode),
        f.setupCalls(),
        (await f.store.list()).length,
      ],
      expected: [
        [200, 201],
        [
          '2025-03-15_07-08-09_Prepare-Atlas-Partner-Launch-Plan',
          '2025-03-15_07-08-09_Prepare-Atlas-Partner-Launch-Plan',
        ],
        ['assist', 'assist'],
        1,
        1,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('activity promotion reuses its readable child after an interrupted parent update and a changed title or clock', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        title: 'Atlas pilot',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree Atlas Partner Pilot Scope' })],
      },
      NOW,
    )
    interruptNextWrite(f.store, parent.id)
    const url = `/${parent.id}/activities/scope/promote`
    const interrupted = await f.request(url, { revision: parent.revision })
    const initialChild = (await f.store.list()).find((item) => item.parentId === parent.id)!
    const renamedChild = await f.store.put({ ...initialChild, title: 'The refined pilot scope' }, initialChild.revision)
    f.advance()
    const retry = await f.request(url, { revision: parent.revision, title: 'A different suggested title' })
    const result = (await retry.json()) as { parent: WorkstreamRecord; child: WorkstreamRecord }
    const repeated = await f.request(url, { revision: result.parent.revision })
    assert({
      given: 'a child saved before promotion failed to update its parent, followed by a later retry',
      should: 'link the original child with its readable creation name and retain its independent edits',
      actual: [
        interrupted.status,
        initialChild.id,
        retry.status,
        result.child.id,
        result.child.title,
        result.child.revision === renamedChild.revision,
        result.parent.activities[0].subworkstreamId,
        result.parent.activities[0].id,
        repeated.status,
        (await f.store.list()).length,
      ],
      expected: [
        503,
        '2025-03-15_07-08-09_Agree-Atlas-Partner-Pilot-Scope',
        200,
        initialChild.id,
        'The refined pilot scope',
        true,
        initialChild.id,
        'scope',
        200,
        2,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('accepting a sub-workstream suggestion recovers its readable child after an interrupted parent update', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        title: 'Atlas pilot',
        proposals: [
          {
            id: 'partner-plan',
            kind: 'subworkstream',
            title: 'Prepare Atlas Partner Launch Plan',
            outcome: 'Prepare the shared launch plan.',
            reason: 'The launch needs independent coordination.',
          },
        ],
      },
      NOW,
    )
    interruptNextWrite(f.store, parent.id)
    const url = `/${parent.id}/proposals/partner-plan/accept`
    const interrupted = await f.request(url, { revision: parent.revision })
    const initialChild = (await f.store.list()).find((item) => item.parentId === parent.id)!
    const revisedChild = await f.store.put(
      { ...initialChild, outcome: 'Launch the agreed smaller pilot.' },
      initialChild.revision,
    )
    f.advance()
    const retry = await f.request(url, { revision: parent.revision })
    const result = (await retry.json()) as { workstream: WorkstreamRecord; created: WorkstreamRecord }
    assert({
      given: 'an accepted child saved before its parent update failed and a retry with a later clock',
      should: 'reuse the same independently edited child and consume the original proposal once',
      actual: [
        interrupted.status,
        initialChild.id,
        retry.status,
        result.created.id,
        result.created.revision === revisedChild.revision,
        result.created.outcome,
        result.created.parentId,
        result.workstream.proposals.length,
        (await f.store.list()).length,
      ],
      expected: [
        503,
        '2025-03-15_07-08-09_Prepare-Atlas-Partner-Launch-Plan',
        200,
        initialChild.id,
        true,
        'Launch the agreed smaller pilot.',
        parent.id,
        0,
        2,
      ],
    })
  } finally {
    await f.clean()
  }
})
