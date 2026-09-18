import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { defaultWorkstreamPosition, CARD_HEIGHT, CARD_WIDTH } from '#lib/workstreams/layout.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, type WorkstreamRecord, type WorkstreamReport } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 12:00'
type Created = WorkstreamRecord & { position: WorkstreamReport['layout'][string] }

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-placement-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const routes = () =>
    createWorkstreamRoutes({
      store,
      now: () => NOW,
      today: () => NOW.slice(0, 10),
      automation: async () => null,
      setup: async () => ({}),
      draft: async () => ({}),
      run: async () => {
        throw new Error('Placement must not run Sky.')
      },
      planDay: async () => {
        throw new Error('Placement must not plan a day.')
      },
    })
  const request = (url: string, body: unknown, method = 'POST') =>
    routes().request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const create = async (body: unknown): Promise<Created> => {
    const response = await request('/create', body)
    if (response.status !== 201 && response.status !== 200) throw new Error(await response.text())
    return response.json()
  }
  return {
    store,
    root,
    request,
    create,
    place: (id: string, point: WorkstreamReport['layout'][string]) => request('/layout', { id, ...point }, 'PUT'),
    report: async (): Promise<WorkstreamReport> => (await routes().request('/status')).json(),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('creation persists a neighboring position without moving or editing an arranged group', async () => {
  const f = await fixture()
  try {
    const first = await f.store.create({ id: 'atlas', title: 'Atlas pilot' }, NOW)
    const second = await f.store.create({ id: 'widget', title: 'Widget launch' }, NOW)
    const arranged = { x: -8000, y: 5000, color: 'mint' as const, order: 4 }
    await f.place(first.id, arranged)
    await f.place(second.id, { x: -7440, y: 5000 })
    const created = await f.create({ title: 'New pilot', requestId: 'new-pilot' })
    const report = await f.report()
    const canonical = await f.store.get(created.id)
    assert({
      given: 'a creation beside an arranged group thousands of pixels from the origin',
      should:
        'persist an adjacent non-overlapping position separately from unchanged canonical work and previous layout',
      actual: [
        created.position.x >= -8000 && created.position.x <= -7440,
        Math.abs(created.position.y - 5000),
        report.layout[created.id],
        report.layout[first.id],
        report.layout[second.id],
        (await f.store.get(first.id))!.revision === first.revision,
        canonical!.position,
      ],
      expected: [true, CARD_HEIGHT + 75, created.position, arranged, { x: -7440, y: 5000 }, true, undefined],
    })
  } finally {
    await f.clean()
  }
})

test('inserting before legacy ids freezes their prior fallback slots across reloads', async () => {
  const f = await fixture()
  try {
    const first = await f.store.create({ id: 'legacy-atlas', title: 'Atlas pilot' }, NOW)
    const second = await f.store.create({ id: 'legacy-widget', title: 'Widget launch' }, NOW)
    const created = await f.create({ title: 'A new pilot' })
    const report = await f.report()
    assert({
      given: 'older unplaced work with tied creation timestamps and a new readable id that sorts before them',
      should: 'retain both existing rendered positions and expose durable placement immediately',
      actual: [
        created.id.localeCompare(first.id) < 0,
        report.layout[first.id],
        report.layout[second.id],
        report.layout[created.id],
      ],
      expected: [true, defaultWorkstreamPosition(0), defaultWorkstreamPosition(1), created.position],
    })
  } finally {
    await f.clean()
  }
})

test('concurrent creates and retries reserve distinct positions and retain later layout edits', async () => {
  const f = await fixture()
  try {
    const body = { title: 'Atlas pilot', requestId: 'atlas-capture' }
    const created = await Promise.all([
      f.create(body),
      f.create({ title: 'Widget launch', requestId: 'widget-capture' }),
      f.create(body),
    ])
    const atlas = created[0]!,
      widget = created[1]!
    const moved = { x: 12000, y: -4000, color: 'violet' as const, order: -2 }
    await f.place(atlas.id, moved)
    const retry = await f.create(body)
    const report = await f.report()
    assert({
      given: 'two new workstreams created simultaneously, with one duplicate capture and a later moved/recolored card',
      should: 'reserve distinct slots once and return the saved placement on retry without rearranging anything',
      actual: [
        (await f.store.list()).length,
        created[2]!.id === atlas.id,
        Math.abs(atlas.position.x - widget.position.x) >= CARD_WIDTH ||
          Math.abs(atlas.position.y - widget.position.y) >= CARD_HEIGHT,
        retry.position,
        report.layout[atlas.id],
        report.layout[widget.id],
      ],
      expected: [2, true, true, moved, moved, widget.position],
    })
  } finally {
    await f.clean()
  }
})

test('a retried accepted creation recovers missing placement without creating work again', async () => {
  const f = await fixture()
  try {
    const body = { title: 'Atlas pilot', requestId: 'recover-placement' }
    const initial = await f.create(body)
    await unlink(path.join(f.store.stateDir, 'layout.json'))
    const retry = await f.create(body)
    assert({
      given: 'the canonical creation accepted before its placement was retained',
      should: 'recover the same card position on retry while keeping one unchanged workstream',
      actual: [
        retry.id,
        retry.revision,
        retry.position,
        (await f.report()).layout[retry.id],
        (await f.store.list()).length,
      ],
      expected: [initial.id, initial.revision, initial.position, initial.position, 1],
    })
  } finally {
    await f.clean()
  }
})

test('promoting an activity and accepting a child suggestion place both children next to their parent', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree pilot scope' })],
        proposals: [
          { id: 'launch', kind: 'subworkstream', title: 'Prepare the launch', reason: 'Coordinate the shared launch.' },
        ],
      },
      NOW,
    )
    await f.place(parent.id, { x: 9000, y: -4000 })
    const response = await f.request(`/${parent.id}/activities/scope/promote`, { revision: parent.revision })
    const result = (await response.json()) as { parent: WorkstreamRecord; child: WorkstreamRecord }
    const accepted = await f.request(`/${parent.id}/proposals/launch/accept`, { revision: result.parent.revision })
    const suggestion = (await accepted.json()) as { created: WorkstreamRecord }
    const report = await f.report()
    assert({
      given: 'an activity expanded and a child suggestion accepted inside a moved parent',
      should: 'persist both children in adjacent free slots without storing layout in notebook content',
      actual: [
        response.status,
        report.layout[parent.id],
        report.layout[result.child.id],
        accepted.status,
        report.layout[suggestion.created.id],
        (await readFile(path.join(f.root, result.child.path), 'utf8')).includes('position:'),
      ],
      expected: [200, { x: 9000, y: -4000 }, { x: 9560, y: -4000 }, 200, { x: 9000, y: -3821 }, false],
    })
  } finally {
    await f.clean()
  }
})
