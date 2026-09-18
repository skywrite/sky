import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WORKSTREAM_COLORS } from '#lib/workstreams/colors.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import type { WorkstreamReport } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:00'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-colors-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const routes = () =>
    createWorkstreamRoutes({
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
  const app = routes()
  return {
    store,
    put: (data: unknown) =>
      app.request('/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    report: async () => (await (await routes().request('/status')).json()) as WorkstreamReport,
    layoutText: () => readFile(path.join(store.stateDir, 'layout.json'), 'utf8'),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('workstream color persists through movement and reordering without changing the work', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas pilot', state: 'active' }, NOW)
    await f.put({ id: work.id, x: 20, y: 40, order: 2, color: 'mint' })
    const moved = await f.put({ id: work.id, x: 140, y: -80 })
    const reordered = await f.put({ id: work.id, order: -1 })
    const beforeRecolor = (await f.report()).layout[work.id]
    const recolored = await f.put({ id: work.id, color: 'violet' })
    const saved = (await f.store.get(work.id))!
    assert({
      given: 'a colored workstream moved, reordered, and then recolored through separate layout requests',
      should: 'persist supplied visual fields, retain omitted fields, and leave canonical state and revision alone',
      actual: [
        moved.status,
        reordered.status,
        recolored.status,
        beforeRecolor,
        (await f.report()).layout[work.id],
        saved.revision === work.revision,
        saved.state,
      ],
      expected: [
        200,
        200,
        200,
        { x: 140, y: -80, order: -1, color: 'mint' },
        { x: 140, y: -80, order: -1, color: 'violet' },
        true,
        'active',
      ],
    })
  } finally {
    await f.clean()
  }
})

test('legacy layouts stay uncolored until an explicit palette selection', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Widget launch' }, NOW)
    await f.put({ id: work.id, x: 0, y: 0 })
    const originalText = await f.layoutText()
    const legacy = (await f.report()).layout[work.id]
    const unchangedText = await f.layoutText()
    const savedColors: unknown[] = []
    for (const color of WORKSTREAM_COLORS) {
      const response = await f.put({ id: work.id, color })
      savedColors.push([response.status, (await f.report()).layout[work.id].color])
    }
    assert({
      given: 'an older layout with no color, then each supported palette choice',
      should: 'read without writing a default, and persist each explicit choice for newly created route instances',
      actual: [legacy, originalText === unchangedText, savedColors],
      expected: [{ x: 0, y: 0 }, true, WORKSTREAM_COLORS.map((color) => [200, color])],
    })
  } finally {
    await f.clean()
  }
})

test('invalid colors and incomplete initial layouts do not overwrite saved preferences', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas scope' }, NOW)
    const unplaced = await f.store.create({ title: 'Widget scope' }, NOW)
    await f.put({ id: work.id, x: 10, y: 30, order: 4, color: 'blue' })
    const originalText = await f.layoutText()
    const invalid = await f.put({ id: work.id, color: 'chartreuse' })
    const missingPosition = await f.put({ id: unplaced.id, color: 'orange' })
    const missingWork = await f.put({ id: 'missing', x: 0, y: 0, color: 'yellow' })
    assert({
      given: 'an unknown color, an unplaced workstream without coordinates, and an unknown workstream',
      should: 'reject each request before changing the stored layout',
      actual: [invalid.status, missingPosition.status, missingWork.status, (await f.layoutText()) === originalText],
      expected: [400, 400, 404, true],
    })
  } finally {
    await f.clean()
  }
})
