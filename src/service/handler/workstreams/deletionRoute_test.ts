import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import {
  SkySchema,
  type WorkstreamDeletionReceipt,
  type WorkstreamReport,
  type WorkstreamRecord,
} from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:00'
test('deletion routes enforce current same-origin writes and expose durable Undo with the original layout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-delete-route-'))
  try {
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
    const request = (url: string, body: unknown, method = 'POST', origin?: string) =>
      app.request(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      })
    let work = await store.create({ title: 'Atlas launch' }, NOW)
    work = await store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), work.revision)
    await request('/layout', { id: work.id, x: 120, y: -40, order: 3 }, 'PUT')
    const foreign = await request(`/${work.id}/delete`, { revision: work.revision }, 'POST', 'https://example.com')
    const invalid = await app.request(`/${work.id}/delete`, { method: 'POST', body: '{}' })
    const stale = await request(`/${work.id}/delete`, { revision: 'stale' })
    const removed = await request(`/${work.id}/delete`, { revision: work.revision })
    const receipt = (await removed.json()) as WorkstreamDeletionReceipt
    const retried = await request(`/${work.id}/delete`, { revision: work.revision })
    const hidden = await app.request(`/${work.id}`)
    const report = (await (await app.request('/status')).json()) as WorkstreamReport
    const wrongUndo = await request(`/${work.id}/restore`, { revision: 'another-deletion' })
    const restoredResponse = await request(`/${work.id}/restore`, { revision: receipt.revision })
    const restored = (await restoredResponse.json()) as WorkstreamRecord
    const finalReport = (await (await app.request('/status')).json()) as WorkstreamReport
    const activePurge = await request(`/${work.id}/purge`, { revision: receipt.revision })
    const removedAgain = await request(`/${work.id}/delete`, { revision: restored.revision })
    const currentReceipt = (await removedAgain.json()) as WorkstreamDeletionReceipt
    const foreignPurge = await request(
      `/${work.id}/purge`,
      { revision: currentReceipt.revision },
      'POST',
      'https://example.com',
    )
    const stalePurge = await request(`/${work.id}/purge`, { revision: receipt.revision })
    const malformedPurge = await request(`/${work.id}/purge`, {})
    const purged = await request(`/${work.id}/purge`, { revision: currentReceipt.revision })
    const purgeRetry = await request(`/${work.id}/purge`, { revision: currentReceipt.revision })
    const noUndo = await request(`/${work.id}/restore`, { revision: currentReceipt.revision })
    const purgedReport = (await (await app.request('/status')).json()) as WorkstreamReport
    assert({
      given: 'a canvas deletion with a lost response retry and a later Undo',
      should: 'enforce revision/origin checks, expose its durable receipt and restore unchanged layout with Sky off',
      actual: [
        foreign.status,
        invalid.status,
        stale.status,
        removed.status,
        await retried.json(),
        hidden.status,
        report.items.length,
        report.deleted,
        wrongUndo.status,
        restoredResponse.status,
        restored.id,
        restored.sky.mode,
        finalReport.deleted,
        finalReport.layout[work.id],
      ],
      expected: [
        403,
        400,
        409,
        200,
        receipt,
        404,
        0,
        [receipt],
        409,
        200,
        work.id,
        'off',
        [],
        { x: 120, y: -40, order: 3 },
      ],
    })
    assert({
      given: 'an explicit permanent deletion with stale, foreign and retried requests',
      should: 'require the current deletion receipt and remove Undo while preserving idempotent retry',
      actual: [
        activePurge.status,
        foreignPurge.status,
        stalePurge.status,
        malformedPurge.status,
        purged.status,
        await purged.json(),
        purgeRetry.status,
        await purgeRetry.json(),
        noUndo.status,
        purgedReport.items,
        purgedReport.deleted,
      ],
      expected: [
        409,
        403,
        409,
        400,
        200,
        { id: work.id, revision: currentReceipt.revision },
        200,
        { id: work.id, revision: currentReceipt.revision },
        409,
        [],
        [],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
