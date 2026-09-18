import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readOptional } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { runWorkstream } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema } from './types.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-deletion-'))
  return {
    root,
    store: new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}
async function status(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return (error as { status?: number }).status
  }
}

test('deleting work preserves notebook evidence and restores its identity after restart with Sky off', async () => {
  const f = await fixture()
  try {
    let work = await f.store.create(
      {
        title: 'Atlas launch',
        notes: 'The original owner notes.',
        extra: { retained: true },
        state: 'paused',
        activities: [
          ActivitySchema.parse({
            id: 'scope',
            title: 'Approve scope',
            kind: 'decision',
            notes: 'Compare the options.',
            outboxId: 'outbox-item',
            participation: [{ day: '2025-03-15', title: 'Approve scope', state: 'ready' }],
          }),
        ],
      },
      NOW,
    )
    const artifact = {
      id: 'brief',
      title: 'Atlas brief',
      path: path.join(path.dirname(work.path), 'artifacts', 'brief.md'),
      created: NOW,
      kind: 'draft' as const,
    }
    await f.store.writeArtifact(work.id, artifact, 'The saved brief.')
    work = await f.store.put({ ...work, artifacts: [artifact] }, work.revision)
    work = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), work.revision)
    const oldGrant = await f.store.getGrant(work.id)
    const layoutFile = path.join(f.store.stateDir, 'layout.json')
    await writeFile(layoutFile, JSON.stringify({ [work.id]: { x: 320, y: -80, order: 2 } }))
    const dayFile = path.join(f.root, 'day-evidence.md'),
      outboxFile = path.join(f.root, 'outbox-evidence.md')
    await writeFile(dayFile, `[Approve scope](/workstreams/${work.id}?activity=scope)`)
    await writeFile(outboxFile, 'Reviewed message retained as historical evidence.')
    const evidence = [
      path.join(f.root, artifact.path),
      path.join(f.root, work.activities[0].decisionPath!),
      dayFile,
      outboxFile,
      layoutFile,
    ]
    const before = await Promise.all(evidence.map((file) => readFile(file, 'utf8')))
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const restarted = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const report = await restarted.report()
    const restored = await restarted.restore(work.id, receipt.revision, NOW)
    assert({
      given: 'a delegated workstream with decisions, artifacts, daily evidence and a saved canvas position',
      should: 'hide it durably without removing evidence and restore the same work with ongoing authority revoked',
      actual: [
        report.items.length,
        report.deleted,
        restored.id,
        restored.notes.trim(),
        restored.extra,
        restored.state,
        restored.activities[0].participation,
        restored.sky.mode,
        (await restarted.getGrant(work.id)).mode,
        (await restarted.getGrant(work.id)).revision !== oldGrant.revision,
        await Promise.all(evidence.map((file) => readFile(file, 'utf8'))),
      ],
      expected: [
        0,
        [receipt],
        work.id,
        'The original owner notes.',
        { retained: true },
        'paused',
        work.activities[0].participation,
        'off',
        'off',
        true,
        before,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('delete and Undo retries are idempotent while stale tokens cannot affect a later deletion', async () => {
  const f = await fixture()
  try {
    const initial = await f.store.create({ title: 'Atlas' }, NOW)
    const updated = await f.store.put({ ...initial, outcome: 'A newer outcome.' }, initial.revision)
    const staleDelete = await status(() => f.store.delete(initial.id, initial.revision, NOW))
    const [receipt, retried] = await Promise.all([
      f.store.delete(updated.id, updated.revision, NOW),
      f.store.delete(updated.id, updated.revision, NOW),
    ])
    const hidden = await f.store.get(updated.id)
    const [restored, restoredRetry] = await Promise.all([
      f.store.restore(updated.id, receipt.revision, NOW),
      f.store.restore(updated.id, receipt.revision, NOW),
    ])
    const edited = await f.store.put({ ...restored, notes: 'A new owner edit after Undo.' }, restored.revision)
    const retryAfterEdit = await f.store.restore(updated.id, receipt.revision, NOW)
    const second = await f.store.delete(edited.id, edited.revision, NOW)
    const oldUndo = await status(() => f.store.restore(edited.id, receipt.revision, NOW))
    const secondRestored = await f.store.restore(edited.id, second.revision, NOW)
    const oldUndoAfterRestore = await status(() => f.store.restore(edited.id, receipt.revision, NOW))
    assert({
      given: 'stale edits, concurrent network retries, newer owner edits and a second deletion event',
      should: 'apply each delete/restore once, preserve newer words and reject obsolete Undo tokens',
      actual: [
        staleDelete,
        receipt.revision === retried.revision,
        hidden,
        restored.revision === restoredRetry.revision,
        retryAfterEdit.notes.trim(),
        oldUndo,
        oldUndoAfterRestore,
        secondRestored.history.filter((entry) => entry.kind === 'deleted').length,
        secondRestored.history.filter((entry) => entry.kind === 'restored').length,
      ],
      expected: [409, true, null, true, 'A new owner edit after Undo.', 409, 409, 2, 2],
    })
  } finally {
    await f.clean()
  }
})

test('normal writes and stale execution cannot resurrect a deleted identity even after its folder moves', async () => {
  const f = await fixture()
  try {
    let work = await f.store.create({ title: 'Atlas' }, NOW)
    work = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'drive' }), work.revision)
    const grant = await f.store.getGrant(work.id)
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const artifact = {
      id: 'late',
      title: 'Late proposal',
      path: path.join(path.dirname(work.path), 'artifacts', 'late.md'),
      created: NOW,
      kind: 'draft' as const,
    }
    const deletedWrite = await status(() => f.store.put({ ...work, notes: 'An obsolete edit.' }, work.revision))
    const staleEffect = await status(() =>
      f.store.commitRunEffect(work, work.revision, grant.revision, artifact, 'Obsolete content'),
    )
    const artifactExists = await readOptional(path.join(f.root, artifact.path))
    await rename(path.join(f.root, path.dirname(work.path)), path.join(f.store.dir, 'moved-atlas'))
    const reusedIdentity = await status(() =>
      f.store.create({ id: work.id, title: 'A conflicting new workstream' }, NOW),
    )
    const restored = await f.store.restore(work.id, receipt.revision, NOW)
    const forgedDeletion = { id: 'forged', at: NOW, previousRevision: restored.revision }
    const ordinaryTombstone = await status(() =>
      f.store.put({ ...restored, deletion: forgedDeletion }, restored.revision),
    )
    const newTombstone = await status(() =>
      f.store.create({ title: 'Another workstream', deletion: forgedDeletion }, NOW),
    )
    const staleAfterUndo = await status(() =>
      f.store.commitRunEffect(work, work.revision, grant.revision, artifact, 'Obsolete content', true),
    )
    assert({
      given: 'prepared model work, ordinary writes, folder movement and attempts to reuse a deleted identity',
      should: 'reject resurrection and stale effects while preserving the original recoverable identity',
      actual: [
        deletedWrite,
        staleEffect,
        artifactExists,
        reusedIdentity,
        ordinaryTombstone,
        newTombstone,
        staleAfterUndo,
        restored.path,
        (await f.store.list()).length,
      ],
      expected: [404, 404, undefined, 409, 400, 400, 409, path.join('workstreams', 'moved-atlas', 'workstream.md'), 1],
    })
  } finally {
    await f.clean()
  }
})

test('deleting a completed prerequisite preserves linked work but makes the dependent action ineligible', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        title: 'Atlas scope',
        activities: [
          ActivitySchema.parse({ id: 'scope', title: 'Agree scope', state: 'done', result: 'Scope agreed.' }),
        ],
      },
      NOW,
    )
    let child = await f.store.create(
      {
        title: 'Atlas launch',
        parentId: parent.id,
        relations: [{ targetId: parent.id, kind: 'related', reason: 'Uses the agreed scope.' }],
        activities: [
          ActivitySchema.parse({
            id: 'launch',
            title: 'Prepare launch',
            executor: 'sky',
            requires: [{ workstreamId: parent.id, activityId: 'scope', result: 'Scope agreed.' }],
          }),
        ],
      },
      NOW,
    )
    child = await f.store.configureSky(child.id, SkySchema.parse({ mode: 'assist' }), child.revision)
    await f.store.delete(parent.id, parent.revision, NOW)
    child = await f.store.put({ ...child, notes: 'Waiting for the required work to be restored.' }, child.revision)
    let eligible: unknown
    const result = await runWorkstream({
      store: f.store,
      id: child.id,
      now: NOW,
      propose: async (context) => {
        eligible = context.eligibleActivityIds
        return {
          summary: 'Prepared launch work.',
          understanding: '',
          unknowns: [],
          outcomeSuggestion: '',
          activities: [],
          decisions: [],
          relationships: [],
          suggestions: [],
          subworkstreams: [],
          artifact: { activityId: 'launch', title: 'Launch plan', body: 'Must remain blocked.' },
          communication: null,
          waitingFor: '',
          nextCheckMinutes: 60,
        }
      },
    })
    const fresh = (await f.store.get(child.id))!
    const newChild = await status(() => f.store.create({ title: 'New child', parentId: parent.id }, NOW))
    assert({
      given: 'a deleted parent whose prerequisite activity had already been completed',
      should:
        'keep the child editable with its historical links, but block new dependent execution and new containment',
      actual: [
        (await f.store.list()).map((item) => item.id),
        fresh.parentId,
        fresh.relations.length,
        fresh.activities[0].requires.length,
        eligible,
        result.status,
        fresh.artifacts.length,
        newChild,
      ],
      expected: [[child.id], parent.id, 1, 1, [], 'failed', 0, 400],
    })
  } finally {
    await f.clean()
  }
})

test('canonical decision edits while deleted survive Undo without rewriting the decision document', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create(
      { title: 'Atlas', activities: [ActivitySchema.parse({ id: 'scope', title: 'Choose scope', kind: 'decision' })] },
      NOW,
    )
    const receipt = await f.store.delete(work.id, work.revision, NOW)
    const file = path.join(f.root, work.activities[0].decisionPath!)
    const document = Document.fromMarkdown(await readFile(file, 'utf8'))
    const changed = new Document(
      { ...document.yaml, resolved: `${NOW} UTC`, result: 'The owner chose the smaller scope.' },
      'Owner context recorded while hidden.',
    ).toMarkdown()
    await writeFile(file, changed)
    const restored = await f.store.restore(work.id, receipt.revision, NOW)
    assert({
      given: 'a canonical decision updated outside the canvas while its workstream is deleted',
      should: 'restore current decision facts and preserve the document byte-for-byte',
      actual: [
        restored.activities[0].state,
        restored.activities[0].result,
        restored.activities[0].notes.trim(),
        await readFile(file, 'utf8'),
      ],
      expected: ['done', 'The owner chose the smaller scope.', 'Owner context recorded while hidden.', changed],
    })
  } finally {
    await f.clean()
  }
})
