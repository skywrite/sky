import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { atomicWrite, hash } from '#lib/outbox/files.ts'
import { assert, test } from '#test'
import { createWorkstreamStorage } from './storage.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema } from './types.ts'

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  )
const NOW = '2025-03-15 12:00'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-storage-'))
  const config = { DIR_BASE: path.join(root, 'Notebook #1'), DIR_STATE: path.join(root, 'state') }
  const storage = createWorkstreamStorage(config)
  const legacy = new WorkstreamStore(storage.legacyDir, storage.stateDir, config.DIR_BASE)
  const current = new WorkstreamStore(
    storage.dir,
    storage.stateDir,
    config.DIR_BASE,
    () => '2025-03-15',
    storage.contentRoot,
    storage.initialize,
  )
  return { root, config, storage, legacy, current, dispose: () => rm(root, { recursive: true, force: true }) }
}

test('workstream storage moves the complete file tree and its charter while retaining logical paths and permissions', async () => {
  const f = await fixture()
  try {
    const work = await f.legacy.create(
      {
        id: 'atlas-pilot',
        title: 'Atlas pilot',
        outcome: 'Launch the pilot.',
        activities: [ActivitySchema.parse({ id: 'scope', kind: 'decision', title: 'Choose the scope' })],
      },
      NOW,
    )
    const owned = [
      work.path,
      work.activities[0]!.decisionPath!,
      'workstreams/atlas-pilot/runs/mock-run.md',
      'workstreams/atlas-pilot/artifacts/notes.txt',
      'workstreams/atlas-pilot/deliveries/mock-delivery.md',
      'workstreams/.purged/mock-removed.json',
      'workstreams/atlas-pilot/.private-sidecar',
    ]
    for (const relative of owned.slice(2))
      await atomicWrite(path.join(f.config.DIR_BASE, relative), `Retain bytes for ${relative}.\n`)
    // The hidden receipt is copied as opaque content, even when it is not a readable domain record.
    await atomicWrite(
      path.join(f.config.DIR_BASE, 'automations', 'Review-Ongoing-Work.md'),
      '---\nrun: workstreams:scan\nevery: 17m\nstatus: paused\n---\nKeep this schedule.\n',
    )
    await atomicWrite(
      path.join(f.config.DIR_BASE, 'automations', 'daily-summary.md'),
      '---\nrun: day:summarize\nevery: 1d\n---\nKeep in the notebook.\n',
    )
    await atomicWrite(path.join(f.storage.stateDir, 'layout.json'), '{"atlas-pilot":{"x":900,"y":200}}')
    await atomicWrite(path.join(f.storage.stateDir, 'permissions', 'atlas-pilot.json'), '{"mode":"off"}')
    const before = await Promise.all(
      owned.map(async (relative) => hash(await readFile(path.join(f.config.DIR_BASE, relative)))),
    )
    await Promise.all([f.storage.initialize(), f.storage.initialize()])
    const after = await Promise.all(
      owned.map(async (relative) => hash(await readFile(path.join(f.storage.contentRoot, relative)))),
    )
    assert({
      given:
        'records, decisions, run history, artifacts, delivery receipts, hidden sidecars and a renamed paused charter',
      should: 'move every owned file byte-for-byte while retaining machine state and unrelated notebook automations',
      actual: [
        after,
        await exists(f.storage.legacyDir),
        await exists(path.join(f.config.DIR_BASE, 'automations', 'Review-Ongoing-Work.md')),
        await exists(path.join(f.storage.automationsDir, 'Review-Ongoing-Work.md')),
        await exists(path.join(f.config.DIR_BASE, 'automations', 'daily-summary.md')),
        await readFile(path.join(f.storage.stateDir, 'layout.json'), 'utf8'),
        await readFile(path.join(f.storage.stateDir, 'permissions', 'atlas-pilot.json'), 'utf8'),
      ],
      expected: [before, false, false, true, true, '{"atlas-pilot":{"x":900,"y":200}}', '{"mode":"off"}'],
    })
    await createWorkstreamStorage(f.config).initialize()
  } finally {
    await f.dispose()
  }
})

test('the state-backed store initializes migration before reading or writing and retains the record revision', async () => {
  const f = await fixture()
  try {
    const original = await f.legacy.create(
      {
        id: 'atlas-pilot',
        title: 'Atlas pilot',
        activities: [ActivitySchema.parse({ id: 'scope', kind: 'decision', title: 'Choose the scope' })],
      },
      NOW,
    )
    const migrated = await f.current.get(original.id)
    const created = await f.current.create({ id: 'widget-launch', title: 'Widget launch' }, NOW)
    assert({
      given: 'a first read followed by a creation with records still in the notebook',
      should: 'migrate before taking writer locks, preserve existing identity and revision, and create only in state',
      actual: [
        migrated,
        await exists(path.join(f.storage.contentRoot, created.path)),
        await exists(f.storage.legacyDir),
      ],
      expected: [original, true, false],
    })
  } finally {
    await f.dispose()
  }
})

test('workstream migration refuses conflicting copies before removing any original and retries after repair', async () => {
  const f = await fixture()
  try {
    const source = path.join(f.storage.legacyDir, 'atlas', 'workstream.md')
    const target = path.join(f.storage.dir, 'atlas', 'workstream.md')
    await atomicWrite(source, 'Original notes.\n')
    await atomicWrite(target, 'Different notes.\n')
    let rejected = false
    try {
      await f.storage.initialize()
    } catch {
      rejected = true
    }
    assert({
      given: 'different existing source and destination content',
      should: 'keep both versions without overwriting either',
      actual: [rejected, await readFile(source, 'utf8'), await readFile(target, 'utf8')],
      expected: [true, 'Original notes.\n', 'Different notes.\n'],
    })
    await writeFile(target, 'Original notes.\n')
    await f.storage.initialize()
    assert({
      given: 'the conflict repaired to identical bytes',
      should: 'resume safely and remove only the identical original',
      actual: [await exists(f.storage.legacyDir), await readFile(target, 'utf8')],
      expected: [false, 'Original notes.\n'],
    })
  } finally {
    await f.dispose()
  }
})

test('workstream migration refuses a symlink without touching its target', async () => {
  const f = await fixture()
  try {
    const external = path.join(f.root, 'external.md')
    await writeFile(external, 'Shared source.\n')
    await mkdir(f.storage.legacyDir, { recursive: true })
    await symlink(external, path.join(f.storage.legacyDir, 'linked.md'))
    let rejected = false
    try {
      await f.storage.initialize()
    } catch {
      rejected = true
    }
    assert({
      given: 'a symlink inside the collection',
      should: 'leave the source and link untouched instead of moving external content',
      actual: [rejected, await exists(f.storage.legacyDir), await readFile(external, 'utf8')],
      expected: [true, true, 'Shared source.\n'],
    })
  } finally {
    await f.dispose()
  }
})

test('migration preserves both files when a canonical decision was relocated outside the collection', async () => {
  const f = await fixture()
  try {
    await atomicWrite(
      path.join(f.config.DIR_BASE, 'decisions/atlas-scope.md'),
      '---\nworkstream: atlas-pilot\nactivity: scope\n---\n',
    )
    const original = await f.legacy.create(
      {
        id: 'atlas-pilot',
        title: 'Atlas pilot',
        activities: [
          ActivitySchema.parse({
            id: 'scope',
            kind: 'decision',
            title: 'Choose the scope',
            decisionPath: 'workstreams/../decisions/atlas-scope.md',
          }),
        ],
      },
      NOW,
    )
    let rejected = false
    try {
      await f.storage.initialize()
    } catch {
      rejected = true
    }
    assert({
      given: 'a legacy decision document outside workstreams/',
      should: 'stop before moving its record and losing the decision reference',
      actual: [
        rejected,
        await exists(path.join(f.config.DIR_BASE, original.path)),
        await exists(path.join(f.config.DIR_BASE, 'decisions/atlas-scope.md')),
        await exists(f.storage.dir),
      ],
      expected: [true, true, true, false],
    })
  } finally {
    await f.dispose()
  }
})

test('migration does not silently leave behind duplicate Workstreams automation charters', async () => {
  const f = await fixture()
  try {
    const charter = '---\nrun: workstreams:scan\nevery: 5m\n---\nReview work.\n'
    const first = path.join(f.config.DIR_BASE, 'automations', 'workstreams.md')
    const second = path.join(f.config.DIR_BASE, 'automations', 'nested', 'workstreams.md')
    await atomicWrite(first, charter)
    await atomicWrite(second, charter)
    let rejected = false
    try {
      await f.storage.initialize()
    } catch {
      rejected = true
    }
    assert({
      given: 'two Workstreams charters with the same scheduler name',
      should: 'stop instead of reporting success with owned files still in the notebook',
      actual: [rejected, await exists(first), await exists(second), await exists(f.storage.automationsDir)],
      expected: [true, true, true, false],
    })
  } finally {
    await f.dispose()
  }
})
