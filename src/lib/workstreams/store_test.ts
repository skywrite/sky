import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { resolveWorkstreamDayItems } from './day.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema } from './types.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-store-'))
  return {
    root,
    store: new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}
async function failed(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

test('workstreams survive restart, folder renaming and edits to human prose without requiring metadata', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      { title: 'Agree the Atlas pilot', notes: 'A rough intention.\n', extra: { keep: true } },
      NOW,
    )
    const folder = path.dirname(path.join(f.root, work.path))
    const moved = path.join(f.store.dir, 'atlas-pilot')
    await rename(folder, moved)
    const restarted = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const current = (await restarted.get(work.id))!
    const changed = await restarted.put({ ...current, outcome: 'Agree a pilot scope.' }, current.revision)
    assert({
      given: 'a minimal workstream moved by its owner and reloaded in a new store',
      should: 'retain identity, prose, unknown metadata and empty optional lists',
      actual: {
        id: changed.id,
        notes: changed.notes.trim(),
        extra: changed.extra,
        people: changed.stakeholders,
        mode: (await restarted.getGrant(work.id)).mode,
      },
      expected: { id: work.id, notes: 'A rough intention.', extra: { keep: true }, people: [], mode: 'off' },
    })
  } finally {
    await f.clean()
  }
})

test('stale writes and copied identities cannot overwrite work', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas' }, NOW)
    await f.store.put({ ...work, outcome: 'A newer outcome.' }, work.revision)
    const stale = await failed(() => f.store.put({ ...work, outcome: 'Old edit.' }, work.revision))
    const copy = path.join(f.store.dir, 'copied', 'workstream.md')
    await mkdir(path.dirname(copy), { recursive: true })
    await writeFile(copy, await readFile(path.join(f.root, work.path), 'utf8'))
    const duplicate = await failed(() => f.store.get(work.id))
    assert({
      given: 'an outdated revision and a duplicated notebook identity',
      should: 'refuse both ambiguities',
      actual: [stale, duplicate, (await f.store.report()).items.length],
      expected: [true, true, 0],
    })
  } finally {
    await f.clean()
  }
})

test('prerequisites and containment reject cycles but allow related work', async () => {
  const f = await fixture()
  try {
    const a = await f.store.create(
      { title: 'Atlas scope', activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree scope' })] },
      NOW,
    )
    const b = await f.store.create(
      {
        title: 'Atlas launch',
        parentId: a.id,
        activities: [
          ActivitySchema.parse({
            id: 'launch',
            title: 'Launch',
            requires: [{ workstreamId: a.id, activityId: 'scope', result: 'Agreed scope' }],
          }),
        ],
      },
      NOW,
    )
    const containment = await failed(() => f.store.put({ ...a, parentId: b.id }, a.revision))
    const dependency = await failed(() =>
      f.store.put(
        {
          ...a,
          activities: [
            ActivitySchema.parse({ ...a.activities[0], requires: [{ workstreamId: b.id, activityId: 'launch' }] }),
          ],
        },
        a.revision,
      ),
    )
    const related = await f.store.put(
      { ...a, relations: [{ targetId: b.id, kind: 'related', reason: 'Contributes to the pilot.' }] },
      a.revision,
    )
    assert({
      given: 'a real prerequisite, hierarchy and a contribution',
      should: 'reject cycles and preserve ordinary relationships',
      actual: [containment, dependency, related.relations.length],
      expected: [true, true, 1],
    })
  } finally {
    await f.clean()
  }
})

test('decision documents are canonical and edits invalidate the workstream revision', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      {
        title: 'Atlas',
        activities: [
          ActivitySchema.parse({
            id: 'scope',
            title: 'Which scope?',
            kind: 'decision',
            notes: 'Explain the tradeoff.',
          }),
        ],
      },
      NOW,
    )
    const file = path.join(f.root, work.activities[0].decisionPath!)
    const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
    await writeFile(
      file,
      new Document(
        { ...doc.yaml, resolved: `${NOW} UTC`, result: 'Start with the smaller scope.' },
        doc.markdown,
      ).toMarkdown(),
    )
    const fresh = (await f.store.get(work.id))!
    assert({
      given: 'a decision resolved directly in its Markdown document',
      should: 'update the canonical work and invalidate older edits',
      actual: {
        state: fresh.activities[0].state,
        result: fresh.activities[0].result,
        changed: fresh.revision !== work.revision,
      },
      expected: { state: 'done', result: 'Start with the smaller scope.', changed: true },
    })
  } finally {
    await f.clean()
  }
})

test('editing agent-visible prose cannot grant authority and revocation rejects a prepared effect', async () => {
  const f = await fixture()
  try {
    let work = await f.store.create({ title: 'Atlas', sky: SkySchema.parse({ mode: 'drive' }) }, NOW)
    const denied = (await f.store.getGrant(work.id)).mode
    work = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), work.revision)
    const grant = await f.store.getGrant(work.id)
    const revoked = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'off' }), work.revision)
    const stale = await failed(() => f.store.commitRunEffect(work, work.revision, grant.revision))
    const manual = await f.store.commitRunEffect(
      { ...revoked, understanding: 'Prepared with one-shot permission.' },
      revoked.revision,
      (await f.store.getGrant(work.id)).revision,
      undefined,
      undefined,
      true,
    )
    assert({
      given: 'agent-visible settings, an explicit grant, revocation and one-shot help',
      should: 'enforce external authority while allowing explicit manual assistance',
      actual: [denied, stale, manual.understanding, (await f.store.getGrant(work.id)).mode],
      expected: ['off', true, 'Prepared with one-shot permission.', 'off'],
    })
  } finally {
    await f.clean()
  }
})

test('symlinked workstream folders cannot redirect local agent effects or artifact reads', async () => {
  const f = await fixture()
  const outside = await mkdtemp(path.join(tmpdir(), 'sky-workstream-outside-'))
  try {
    await writeFile(path.join(outside, 'keep.txt'), 'Unrelated content')
    let work = await f.store.create({ title: 'Atlas' }, NOW)
    const folder = path.dirname(path.join(f.root, work.path))
    for (const name of ['artifacts', 'runs', 'decisions']) await symlink(outside, path.join(folder, name))
    await symlink(outside, path.join(f.store.dir, 'linked'))
    const artifact = {
      id: 'brief',
      title: 'Launch brief',
      path: path.join(path.dirname(work.path), 'artifacts', 'brief.md'),
      created: NOW,
      kind: 'draft' as const,
    }
    work = await f.store.put({ ...work, artifacts: [artifact] }, work.revision)
    const artifactWrite = await failed(() => f.store.writeArtifact(work.id, artifact, 'New brief'))
    const artifactRead = await failed(() => f.store.readArtifact(work.id, artifact.id))
    const runWrite = await failed(() =>
      f.store.putRun({
        id: 'run',
        workstreamId: work.id,
        status: 'running',
        trigger: 'manual',
        started: NOW,
        summary: '',
        artifactIds: [],
      }),
    )
    const decisionWrite = await failed(() =>
      f.store.put(
        { ...work, activities: [ActivitySchema.parse({ id: 'decision', title: 'Approve scope?', kind: 'decision' })] },
        work.revision,
      ),
    )
    const creation = await failed(() => f.store.create({ id: 'linked', title: 'A new workstream' }, NOW))
    assert({
      given: 'artifact, run, decision and new-workstream folders replaced by symbolic links',
      should: 'refuse every redirected effect and preserve unrelated files',
      actual: [
        artifactWrite,
        artifactRead,
        runWrite,
        decisionWrite,
        creation,
        await readdir(outside),
        await readFile(path.join(outside, 'keep.txt'), 'utf8'),
      ],
      expected: [true, true, true, true, true, ['keep.txt'], 'Unrelated content'],
    })
  } finally {
    await f.clean()
    await rm(outside, { recursive: true, force: true })
  }
})

test('canvas and Sky state changes retain the effective day’s snapshot after midnight', async () => {
  const f = await fixture()
  try {
    let effectiveDay = '2025-03-15'
    const store = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root, () => effectiveDay)
    let work = await store.create(
      {
        title: 'Atlas',
        activities: [
          ActivitySchema.parse({
            id: 'brief',
            title: 'Prepare brief',
            participation: [{ day: effectiveDay, title: 'Prepare brief', state: 'ready' }],
          }),
        ],
      },
      NOW,
    )
    work = await store.put(
      {
        ...work,
        activities: work.activities.map((activity) => ({
          ...activity,
          state: 'done' as const,
          result: 'Owner approved the brief.',
        })),
      },
      work.revision,
    )
    const completed = work.activities[0].participation[0]
    effectiveDay = '2025-03-16'
    work = await store.put(
      {
        ...work,
        activities: work.activities.map((activity) => ({
          ...activity,
          state: 'ready' as const,
          participation: [
            ...activity.participation,
            { day: effectiveDay, title: activity.title, state: 'ready' as const },
          ],
        })),
      },
      work.revision,
    )
    const grant = await store.getGrant(work.id)
    work = await store.commitRunEffect(
      {
        ...work,
        updated: `${effectiveDay} 09:00`,
        activities: work.activities.map((activity) => ({
          ...activity,
          state: 'waiting' as const,
          waitingFor: 'Owner review.',
        })),
      },
      work.revision,
      grant.revision,
      undefined,
      undefined,
      true,
    )
    const row = {
      text: 'Prepare brief',
      raw: `[Prepare brief](/workstreams/${work.id}?activity=brief)`,
      link: null,
      done: false,
    }
    const yesterday = await resolveWorkstreamDayItems(store, '2025-03-15', effectiveDay, [row])
    assert({
      given: 'a canvas completion yesterday and a Sky result today',
      should: 'write the effective day’s state while preserving yesterday’s completion',
      actual: [
        completed.state,
        Boolean(completed.reportedAt),
        work.activities[0].participation.map((entry) => entry.state),
        yesterday[0].done,
      ],
      expected: ['done', true, ['done', 'waiting'], true],
    })
  } finally {
    await f.clean()
  }
})
