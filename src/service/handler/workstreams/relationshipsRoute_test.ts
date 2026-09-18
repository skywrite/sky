import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, type Workstream, type WorkstreamRecord } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-relationships-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const app = createWorkstreamRoutes({
    store,
    now: () => NOW,
    today: () => NOW.slice(0, 10),
    automation: async () => null,
    setup: async () => ({}),
    draft: async () => ({}),
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
  const request = (url: string, data: unknown, method = 'POST') =>
    app.request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  const source = async (target: WorkstreamRecord, proposal: Partial<Workstream['proposals'][number]> = {}) =>
    store.create(
      {
        title: 'Atlas launch',
        activities: [
          ActivitySchema.parse({ id: 'launch', title: 'Start the pilot' }),
          ActivitySchema.parse({ id: 'prepare', title: 'Prepare support' }),
        ],
        proposals: [
          {
            id: 'link',
            kind: 'relation',
            title: 'Connect the pilot work',
            reason: 'Uses the agreed scope.',
            targetId: target.id,
            ...proposal,
          },
        ],
      },
      NOW,
    )
  return { store, request, source, clean: () => rm(root, { recursive: true, force: true }) }
}

test('accepted relationship suggestions preserve contribution and containment direction without blocking activities', async () => {
  const f = await fixture()
  try {
    const target = await f.store.create({ title: 'Atlas pilot' }, NOW)
    const results: unknown[] = []
    for (const kind of ['related', 'contributes', 'part-of'] as const) {
      const work = await f.source(target, { relationKind: kind })
      const response = await f.request(`/${work.id}/proposals/link/accept`, { revision: work.revision })
      const saved = (await f.store.get(work.id))!
      results.push([
        response.status,
        saved.parentId ?? null,
        saved.relations.map((entry) => entry.kind),
        saved.activities.flatMap((activity) => activity.requires).length,
        saved.proposals.length,
      ])
    }
    assert({
      given: 'three reviewed relationship meanings toward the same target',
      should: 'persist each meaning on the source without adding hard prerequisites or changing the target',
      actual: [results, (await f.store.get(target.id))!.revision === target.revision],
      expected: [
        [
          [200, null, ['related'], 0, 0],
          [200, null, ['contributes'], 0, 0],
          [200, target.id, [], 0, 0],
        ],
        true,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('an incomplete Sky prerequisite remains reviewable until the owner selects both activities and the required result', async () => {
  const f = await fixture()
  try {
    const target = await f.store.create(
      {
        title: 'Atlas scope',
        activities: [ActivitySchema.parse({ id: 'approve', title: 'Approve scope', kind: 'decision' })],
      },
      NOW,
    )
    const work = await f.source(target, { relationKind: 'prerequisite' })
    const incomplete = await f.request(`/${work.id}/proposals/link/accept`, { revision: work.revision })
    const afterIncomplete = (await f.store.get(work.id))!
    const relation = {
      kind: 'prerequisite',
      targetId: target.id,
      reason: 'The pilot needs an approved scope.',
      activityId: 'launch',
      requiredActivityId: 'approve',
      requiredResult: 'The small pilot scope is approved.',
    }
    const badActivity = await f.request(`/${work.id}/proposals/link/accept`, {
      revision: work.revision,
      relation: { ...relation, requiredActivityId: 'missing' },
    })
    const response = await f.request(`/${work.id}/proposals/link/accept`, { revision: work.revision, relation })
    const saved = (await f.store.get(work.id))!
    const stale = await f.request(`/${work.id}/proposals/link/accept`, { revision: work.revision, relation })
    assert({
      given: 'a prerequisite with unknown scope, an invalid selection, then an explicit review',
      should: 'preserve the draft after failed acceptance and atomically connect only the chosen activity',
      actual: [
        incomplete.status,
        afterIncomplete.revision === work.revision,
        afterIncomplete.proposals.length,
        badActivity.status,
        response.status,
        stale.status,
        saved.proposals.length,
        saved.relations,
        saved.activities.map((activity) => activity.requires),
      ],
      expected: [
        400,
        true,
        1,
        400,
        200,
        409,
        0,
        [],
        [[{ workstreamId: target.id, activityId: 'approve', result: 'The small pilot scope is approved.' }], []],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('older prerequisite and ambiguous child proposals never silently become generic links', async () => {
  const f = await fixture()
  try {
    const target = await f.store.create({ title: 'Atlas pilot' }, NOW)
    const results: unknown[] = []
    for (const reason of ['prerequisite: Needs scope approval.', 'child: Has a smaller outcome.']) {
      const work = await f.source(target, { reason })
      const response = await f.request(`/${work.id}/proposals/link/accept`, { revision: work.revision })
      const saved = (await f.store.get(work.id))!
      results.push([response.status, saved.proposals.length, saved.relations.length, saved.parentId ?? null])
    }
    assert({
      given: 'saved proposals from before relationship metadata existed',
      should: 'leave consequential ambiguous changes for an explicit review',
      actual: results,
      expected: [
        [400, 1, 0, null],
        [400, 1, 0, null],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('manual relationship edits validate exact references and cycles while allowing nonblocking contribution loops', async () => {
  const f = await fixture()
  try {
    let a = await f.store.create(
      { title: 'Atlas scope', activities: [ActivitySchema.parse({ id: 'scope', title: 'Approve scope' })] },
      NOW,
    )
    let b = await f.source(a)
    const edit = (work: WorkstreamRecord, patch: unknown) =>
      f.request(`/${work.id}`, { revision: work.revision, patch }, 'PUT')
    const missing = await edit(b, { relations: [{ targetId: 'missing', kind: 'related', reason: '' }] })
    const self = await edit(b, { relations: [{ targetId: b.id, kind: 'related', reason: '' }] })
    const blank = await edit(b, {
      activities: [{ ...b.activities[0], requires: [{ workstreamId: a.id, activityId: 'scope', result: '' }] }],
    })
    const linked = await edit(b, {
      parentId: a.id,
      relations: [{ targetId: a.id, kind: 'contributes', reason: 'Supports the pilot.' }],
      activities: [
        { ...b.activities[0], requires: [{ workstreamId: a.id, activityId: 'scope', result: 'Approved scope.' }] },
        b.activities[1],
      ],
    })
    b = (await f.store.get(b.id))!
    const parentCycle = await edit(a, { parentId: b.id })
    const resultCycle = await edit(a, {
      activities: [
        { ...a.activities[0], requires: [{ workstreamId: b.id, activityId: 'launch', result: 'Pilot started.' }] },
      ],
    })
    const removeRequired = await edit(a, { activities: [] })
    const nonblocking = await edit(a, {
      relations: [{ targetId: b.id, kind: 'contributes', reason: 'Informs the scope.' }],
    })
    a = (await f.store.get(a.id))!
    const removed = await edit(b, {
      parentId: null,
      relations: [],
      activities: b.activities.map((activity) => ({ ...activity, requires: [] })),
    })
    b = (await f.store.get(b.id))!
    const producerRemoved = await edit(a, { activities: [] })
    assert({
      given: 'manual source-side changes with exact result references and independently useful related outcomes',
      should:
        'reject missing targets, self-links, unnamed results, hierarchy/dependency cycles, and dangling results; allow contribution loops and removal',
      actual: [
        missing.status,
        self.status,
        blank.status,
        linked.status,
        parentCycle.status,
        resultCycle.status,
        removeRequired.status,
        nonblocking.status,
        removed.status,
        producerRemoved.status,
        b.parentId ?? null,
        b.relations.length,
        b.activities.flatMap((activity) => activity.requires).length,
      ],
      expected: [400, 400, 400, 200, 400, 400, 400, 200, 200, 200, null, 0, 0],
    })
  } finally {
    await f.clean()
  }
})
