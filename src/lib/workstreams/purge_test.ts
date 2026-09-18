import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readOptional } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { finishWorkstreamPurge, planWorkstreamPurge, readWorkstreamPurges, writeWorkstreamPurge } from './purge.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema } from './types.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-purge-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  return { root, store, clean: () => rm(root, { recursive: true, force: true }) }
}
async function status(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return (error as { status?: number }).status
  }
}

test('permanent deletion removes owned content and authority but retains only retry protection', async () => {
  const f = await fixture()
  try {
    const operationId = 'capture:atlas-pilot'
    let work = await f.store.create(
      {
        title: 'Atlas pilot',
        notes: 'Original private notes.',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Choose scope', kind: 'decision' })],
      },
      NOW,
      { operationId },
    )
    work = await f.store.configureSky(
      work.id,
      SkySchema.parse({ mode: 'assist', instruction: 'Prepare the pilot.' }),
      work.revision,
    )
    const folder = path.join(f.root, path.dirname(work.path))
    const artifact = {
      id: 'brief',
      title: 'Pilot brief',
      kind: 'draft' as const,
      created: NOW,
      path: `${path.dirname(work.path)}/artifacts/brief.md`,
    }
    await f.store.writeArtifact(work.id, artifact, 'Prepared brief.')
    await f.store.putRun({
      id: 'review',
      workstreamId: work.id,
      status: 'completed',
      trigger: 'manual',
      started: NOW,
      summary: 'Prepared a brief.',
      artifactIds: ['brief'],
    })
    await mkdir(path.join(folder, 'deliveries'))
    await writeFile(
      path.join(folder, 'deliveries', 'report.md'),
      new Document({ id: 'report', workstreamId: work.id }, 'Report copy.').toMarkdown(),
    )
    const grantFile = path.join(f.store.stateDir, 'permissions', `report-${work.id}-team.json`)
    await writeFile(
      grantFile,
      JSON.stringify({ workstreamId: work.id, reportingId: 'team', mode: 'send', target: 'Synthetic target' }),
    )
    await writeFile(path.join(f.store.stateDir, `${work.id}.review.json`), '{}')
    const active = await status(() => f.store.purge(work.id, work.revision))
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const wrong = await status(() => f.store.purge(work.id, 'wrong-deletion'))
    const result = await f.store.purge(work.id, receipt.revision)
    const restarted = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const replay = await restarted.purge(work.id, receipt.revision)
    const report = await restarted.report()
    const forbidden = await Promise.all([
      status(() => restarted.restore(work.id, receipt.revision)),
      status(() => restarted.create({ title: 'Retried title' }, NOW, { operationId })),
      status(() => restarted.create({ id: work.id, title: 'Reused identity' }, NOW)),
      status(() =>
        restarted.putRun({
          id: 'late',
          workstreamId: work.id,
          status: 'failed',
          trigger: 'manual',
          started: NOW,
          summary: 'Late result.',
          artifactIds: [],
        }),
      ),
    ])
    const next = await restarted.create({ title: work.title }, NOW)
    assert({
      given: 'a workstream with decisions, artifacts, runs, deliveries, authority and a creation operation',
      should: 'remove its owned content, support retry after restart, and prevent Undo or obsolete creation',
      actual: [
        active,
        wrong,
        result,
        replay,
        report,
        forbidden,
        await readOptional(path.join(folder, 'workstream.md')),
        await readOptional(path.join(f.root, artifact.path)),
        await readOptional(path.join(f.root, work.activities[0].decisionPath!)),
        await readOptional(path.join(folder, 'runs', 'review.md')),
        await readOptional(path.join(folder, 'deliveries', 'report.md')),
        await readOptional(grantFile),
        (await restarted.getGrant(work.id)).mode,
        next.id === `${work.id}-2`,
        Object.keys((await readWorkstreamPurges(f.root, f.store.dir))[0]).sort(),
      ],
      expected: [
        409,
        409,
        { id: work.id, revision: receipt.revision },
        { id: work.id, revision: receipt.revision },
        { items: [], deleted: [], errors: [] },
        [409, 409, 409, 404],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'off',
        true,
        ['creationOperationHash', 'id', 'revision'],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('purging a moved parent preserves nested work, shared files and unrelated content without following links', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        title: 'Atlas parent',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree scope', state: 'done' })],
      },
      NOW,
    )
    const folder = path.join(f.root, path.dirname(parent.path))
    const artifact = {
      id: 'shared',
      title: 'Shared brief',
      kind: 'draft' as const,
      created: NOW,
      path: `${path.dirname(parent.path)}/artifacts/shared.md`,
    }
    await f.store.writeArtifact(parent.id, artifact, 'Shared source material.')
    let child = await f.store.create(
      {
        title: 'Atlas child',
        parentId: parent.id,
        sources: [{ id: 'brief', path: artifact.path, label: 'Shared brief', sensitive: false }],
        relations: [{ targetId: parent.id, kind: 'related', reason: 'Uses the scope.' }],
        activities: [
          ActivitySchema.parse({
            id: 'launch',
            title: 'Prepare launch',
            requires: [{ workstreamId: parent.id, activityId: 'scope', result: 'Agreed scope' }],
          }),
        ],
      },
      NOW,
    )
    const outside = path.join(f.root, 'shared.md')
    await writeFile(outside, 'External source and historical evidence.')
    await symlink(outside, path.join(folder, 'artifacts', 'linked.md'))
    await writeFile(path.join(folder, 'notes.md'), 'Unrelated notes.')
    await rename(path.join(f.root, path.dirname(child.path)), path.join(folder, 'child'))
    const receipt = await f.store.delete(parent.id, parent.revision, NOW)
    await f.store.purge(parent.id, receipt.revision)
    child = (await f.store.get(child.id))!
    const edited = await f.store.put({ ...child, notes: 'Proceed with independent work.' }, child.revision)
    const newLink = await status(() => f.store.create({ title: 'New child', parentId: parent.id }, NOW))
    const newDependency = await status(() =>
      f.store.put(
        {
          ...edited,
          activities: [
            ...edited.activities,
            ActivitySchema.parse({
              id: 'another',
              title: 'Another action',
              requires: [{ workstreamId: parent.id, activityId: 'scope', result: 'Agreed scope' }],
            }),
          ],
        },
        edited.revision,
      ),
    )
    assert({
      given: 'a parent with a physically nested child, existing dependencies, a shared artifact and a symlink',
      should: 'keep surviving work editable and preserve files that are not exclusively owned by the deleted work',
      actual: [
        edited.parentId,
        edited.relations.length,
        edited.activities[0].requires.length,
        edited.notes.trim(),
        (await f.store.list()).map((entry) => entry.id),
        await readFile(outside, 'utf8'),
        await readFile(path.join(folder, 'notes.md'), 'utf8'),
        (await readFile(path.join(f.root, artifact.path), 'utf8')).includes('Shared source material.'),
        newLink,
        newDependency,
      ],
      expected: [
        parent.id,
        1,
        1,
        'Proceed with independent work.',
        [child.id],
        'External source and historical evidence.',
        'Unrelated notes.',
        true,
        400,
        400,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('a stale permanent-delete receipt cannot remove restored or subsequently deleted work', async () => {
  const f = await fixture()
  try {
    let work = await f.store.create({ title: 'Atlas' }, NOW)
    const first = await f.store.delete(work.id, work.revision, NOW)
    work = await f.store.restore(work.id, first.revision, NOW)
    const restored = await status(() => f.store.purge(work.id, first.revision))
    const latest = await f.store.delete(work.id, work.revision, NOW)
    const old = await status(() => f.store.purge(work.id, first.revision))
    assert({
      given: 'a stale confirmation after Undo and a later deletion',
      should: 'reject both stale attempts and retain the latest recoverable work',
      actual: [restored, old, (await f.store.report()).deleted],
      expected: [409, 409, [latest]],
    })
  } finally {
    await f.clean()
  }
})

test('an interrupted permanent deletion resumes cleanup without reactivating work or deleting changed files', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas' }, NOW, { operationId: 'capture:interrupted' })
    const artifact = {
      id: 'brief',
      title: 'Brief',
      kind: 'draft' as const,
      created: NOW,
      path: `${path.dirname(work.path)}/artifacts/brief.md`,
    }
    await f.store.writeArtifact(work.id, artifact, 'Prepared brief.')
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const tombstone = { ...work, deletion: { id: receipt.revision, at: NOW, previousRevision: work.revision } }
    const plan = await planWorkstreamPurge(f.root, f.store.stateDir, tombstone, [])
    await writeWorkstreamPurge(f.root, f.store.dir, plan)
    const file = path.join(f.root, artifact.path)
    const original = await readFile(file, 'utf8')
    await writeFile(file, 'A newer file must survive.')
    const changed = await status(() => finishWorkstreamPurge(f.root, f.store.dir, f.store.stateDir, plan))
    const preserved = await readFile(file, 'utf8')
    const pending = (await f.store.report()).deleted
    const cannotUndo = await status(() => f.store.restore(work.id, receipt.revision))
    await writeFile(file, original)
    await unlink(file)
    const resumed = await f.store.purge(work.id, receipt.revision)
    assert({
      given: 'a persisted deletion plan, a changed file and partially removed content',
      should: 'preserve changed content and safely resume once the conflict is repaired',
      actual: [
        changed,
        preserved,
        pending,
        cannotUndo,
        resumed,
        await f.store.get(work.id),
        (await f.store.report()).deleted,
      ],
      expected: [
        409,
        'A newer file must survive.',
        [{ ...receipt, purging: true }],
        409,
        { id: work.id, revision: receipt.revision },
        null,
        [],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('resuming a purge preserves files newly shared with surviving work and refuses an incomplete peer inventory', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ title: 'Atlas' }, NOW)
    const artifact = {
      id: 'brief',
      title: 'Brief',
      kind: 'draft' as const,
      created: NOW,
      path: `${path.dirname(work.path)}/artifacts/brief.md`,
    }
    await f.store.writeArtifact(work.id, artifact, 'Source used by later work.')
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const tombstone = { ...work, deletion: { id: receipt.revision, at: NOW, previousRevision: work.revision } }
    const plan = await planWorkstreamPurge(f.root, f.store.stateDir, tombstone, [])
    await writeWorkstreamPurge(f.root, f.store.dir, plan)
    const peer = await f.store.create(
      {
        title: 'Later pilot',
        sources: [{ id: 'brief', path: artifact.path, label: 'Saved source', sensitive: false }],
      },
      NOW,
    )
    const peerFile = path.join(f.root, peer.path)
    const originalPeer = await readFile(peerFile, 'utf8')
    await writeFile(peerFile, 'Invalid workstream metadata.')
    const blocked = await status(() => f.store.purge(work.id, receipt.revision))
    await writeFile(peerFile, originalPeer)
    await f.store.purge(work.id, receipt.revision)
    assert({
      given: 'another workstream referring to an artifact after a deletion was interrupted',
      should: 'require a readable peer inventory and preserve the newly shared source on retry',
      actual: [
        blocked,
        (await readFile(path.join(f.root, artifact.path), 'utf8')).includes('Source used by later work.'),
        (await f.store.list()).map((entry) => entry.id),
        (await f.store.report()).deleted,
      ],
      expected: [409, true, [peer.id], []],
    })
  } finally {
    await f.clean()
  }
})
