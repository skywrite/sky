import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { resolveWorkstreamFile } from './files.ts'
import { planWorkstreamPurge, writeWorkstreamPurge } from './purge.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema, SkySchema } from './types.ts'

const NOW = '2025-03-15 12:00'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-content-'))
  const notebook = path.join(root, 'notebook')
  const state = path.join(root, 'state')
  const content = path.join(state, 'content')
  await mkdir(path.join(notebook, 'time'), { recursive: true })
  await writeFile(path.join(notebook, 'time', 'pilot.md'), 'The original pilot source.')
  const store = () =>
    new WorkstreamStore(path.join(content, 'workstreams'), state, notebook, () => NOW.slice(0, 10), content)
  return {
    root,
    notebook,
    state,
    content,
    store: store(),
    restart: store,
    clean: () => rm(root, { recursive: true, force: true }),
  }
}
async function rejected(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

test('separate content storage keeps records, canonical decisions, artifacts and runs out of the notebook', async () => {
  const f = await fixture()
  try {
    let work = await f.store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        notes: 'Coordinate the pilot.',
        sources: [{ id: 'pilot', path: 'time/pilot.md', label: 'Pilot notes', sensitive: false }],
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree scope', kind: 'decision' })],
      },
      NOW,
    )
    const initial = work
    const decisionPath = work.activities[0]!.decisionPath!
    const decisionFile = path.join(f.content, decisionPath)
    const decision = Document.fromMarkdown(await readFile(decisionFile, 'utf8'))
    await writeFile(
      decisionFile,
      new Document({ ...decision.yaml, summary: 'Agree a smaller scope' }, 'Owner context.').toMarkdown(),
    )
    work = (await f.store.get(work.id))!
    const artifact = {
      id: 'brief',
      title: 'Pilot brief',
      kind: 'draft' as const,
      created: NOW,
      path: 'workstreams/atlas/artifacts/brief.md',
    }
    await f.store.writeArtifact(work.id, artifact, 'Prepared brief.')
    work = await f.store.put({ ...work, artifacts: [artifact] }, work.revision)
    await f.store.putRun({
      id: 'review',
      workstreamId: work.id,
      status: 'completed',
      trigger: 'manual',
      started: NOW,
      summary: 'Prepared a brief.',
      artifactIds: [artifact.id],
    })
    work = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), work.revision)
    const restarted = f.restart()
    const saved = (await restarted.get(work.id))!
    assert({
      given: 'state-backed work with an editable decision, generated brief, run and notebook source',
      should: 'retain logical references and restart behavior while leaving the notebook untouched',
      actual: [
        saved.path,
        decisionPath,
        initial.revision !== saved.revision,
        saved.activities[0]!.title,
        saved.activities[0]!.notes.trim(),
        (await restarted.readArtifact(work.id, artifact.id)).content.trim(),
        (await restarted.runs(work.id)).map((run) => run.id),
        await restarted.resolveFile(saved.path),
        await restarted.resolveFile('time/pilot.md'),
        await readdir(f.notebook),
        await readFile(path.join(f.notebook, 'time', 'pilot.md'), 'utf8'),
      ],
      expected: [
        'workstreams/atlas/workstream.md',
        'workstreams/atlas/decisions/scope.md',
        true,
        'Agree a smaller scope',
        'Owner context.',
        'Prepared brief.',
        ['review'],
        path.join(f.content, saved.path),
        path.join(f.notebook, 'time', 'pilot.md'),
        ['time'],
        'The original pilot source.',
      ],
    })
  } finally {
    await f.clean()
  }
})

test('logical references choose one storage root and reject traversal or symlink escape without notebook fallback', async () => {
  const f = await fixture()
  try {
    const work = await f.store.create({ id: 'atlas', title: 'Atlas pilot' }, NOW)
    await mkdir(path.join(f.notebook, 'workstreams', 'atlas'), { recursive: true })
    await writeFile(path.join(f.notebook, work.path), 'A stale notebook copy.')
    await writeFile(path.join(f.notebook, 'workstreams', 'atlas', 'only-notebook.md'), 'Do not fall back here.')
    await symlink(path.join(f.notebook, 'time', 'pilot.md'), path.join(f.content, 'workstreams', 'atlas', 'linked.md'))
    await symlink(path.join(f.content, work.path), path.join(f.notebook, 'time', 'linked.md'))
    const forbidden = [
      '../state/content/workstreams/atlas/workstream.md',
      'workstreams/../../notebook/time/pilot.md',
      'time/../workstreams/atlas/workstream.md',
      path.join(f.content, work.path),
      'workstreams/atlas/only-notebook.md',
      'workstreams/atlas/linked.md',
      'time/linked.md',
    ]
    assert({
      given: 'a stale notebook copy, notebook-only owned path, traversal attempts and cross-root symlinks',
      should: 'resolve owned paths only in content storage and reject every escape or fallback',
      actual: [
        await resolveWorkstreamFile(f.notebook, f.content, `./${work.path}`),
        await Promise.all(forbidden.map((relative) => rejected(() => f.store.resolveFile(relative)))),
        await readFile(path.join(f.notebook, work.path), 'utf8'),
      ],
      expected: [path.join(f.content, work.path), forbidden.map(() => true), 'A stale notebook copy.'],
    })
  } finally {
    await f.clean()
  }
})

test('state-backed delete, restore and purge preserve notebook evidence and shared owned sources', async () => {
  const f = await fixture()
  try {
    const parent = await f.store.create(
      {
        id: 'atlas',
        title: 'Atlas pilot',
        activities: [ActivitySchema.parse({ id: 'scope', title: 'Agree scope', kind: 'decision' })],
      },
      NOW,
    )
    const artifact = {
      id: 'brief',
      title: 'Shared brief',
      kind: 'draft' as const,
      created: NOW,
      path: 'workstreams/atlas/artifacts/brief.md',
    }
    await f.store.writeArtifact(parent.id, artifact, 'Shared evidence.')
    const child = await f.store.create(
      {
        id: 'widget',
        title: 'Widget launch',
        sources: [
          { id: 'brief', path: artifact.path, label: 'Shared brief', sensitive: false },
          { id: 'pilot', path: 'time/pilot.md', label: 'Pilot notes', sensitive: false },
        ],
      },
      NOW,
    )
    const first = await f.store.delete(parent.id, parent.revision, NOW)
    const restored = await f.restart().restore(parent.id, first.revision, NOW)
    const receipt = await f.store.delete(parent.id, restored.revision, NOW)
    const plan = await planWorkstreamPurge(
      f.content,
      f.state,
      {
        ...restored,
        deletion: { id: receipt.revision, at: NOW, previousRevision: restored.revision },
      },
      [child],
      f.notebook,
    )
    await writeWorkstreamPurge(f.content, f.store.dir, {
      ...plan,
      pending: {
        ...plan.pending!,
        files: plan.pending!.files.map((file) => ({ ...file, area: file.area === 'content' ? 'notebook' : file.area })),
      },
    })
    await f.restart().purge(parent.id, receipt.revision)
    assert({
      given: 'a restored workstream with a shared source and a pending purge that uses the old notebook-area label',
      should:
        'remove exclusively owned content while keeping shared evidence, notebook notes and purge retry protection',
      actual: [
        await readOptional(path.join(f.content, parent.path)),
        await readOptional(path.join(f.content, parent.activities[0]!.decisionPath!)),
        (await readFile(await f.store.resolveFile(artifact.path), 'utf8')).includes('Shared evidence.'),
        (await f.restart().list()).map((item) => item.id),
        await f.restart().purge(parent.id, receipt.revision),
        await readdir(f.notebook),
        await readFile(path.join(f.notebook, 'time', 'pilot.md'), 'utf8'),
      ],
      expected: [
        undefined,
        undefined,
        true,
        [child.id],
        { id: parent.id, revision: receipt.revision },
        ['time'],
        'The original pilot source.',
      ],
    })
  } finally {
    await f.clean()
  }
})

test('the store initializes storage before entering its own writer lock', async () => {
  const f = await fixture()
  try {
    let initialized: Promise<void> | undefined
    let prepared = false
    const initialize = () =>
      (initialized ??= withLock(path.join(f.state, 'write.lock'), async () => {
        prepared = true
      }))
    const store = new WorkstreamStore(f.store.dir, f.state, f.notebook, () => NOW.slice(0, 10), f.content, initialize)
    const work = await store.create({ id: 'atlas', title: 'Atlas pilot' }, NOW)
    const found = await store.getByCreationOperation('missing')
    assert({
      given: 'an initializer that must acquire the same writer lock used by creation',
      should: 'complete initialization before writing and keep later reads usable without deadlocking',
      actual: [prepared, work.path, (await store.list()).length, found],
      expected: [true, 'workstreams/atlas/workstream.md', 1, null],
    })
  } finally {
    await f.clean()
  }
})
