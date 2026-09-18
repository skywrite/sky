import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { collidingWorkstreamId, readableWorkstreamId, workstreamIdentityTime } from './identities.ts'
import { WorkstreamStore, workstreamNow } from './store.ts'
import { Id } from './types.ts'

const NOW = '2025-03-15 18:30'
const LOCAL = '2025-03-15 13:30:42'
const TITLE = 'Launch the Atlas Pilot'

test('identity timestamps retain real seconds and the local calendar date', () => {
  assert({
    given: 'a UTC instant after midnight that falls on the previous day in the owner timezone',
    should: 'format the local date and time through exact seconds',
    actual: workstreamIdentityTime('America/Chicago', '2025-03-16T04:30:42.987Z'),
    expected: '2025-03-15T23:30:42',
  })
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-identities-'))
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

test('readable creation names preserve title case, seconds, word boundaries and valid folder identities', () => {
  const long = readableWorkstreamId({ title: 'A'.repeat(200) }, LOCAL)
  assert({
    given: 'mixed case, accented text, long intentions and a short title',
    should: 'use up to six title words without filler, transliterate accents, and stay inside the identity limit',
    actual: [
      readableWorkstreamId({ title: TITLE }, LOCAL),
      readableWorkstreamId({ title: 'Agree the Café Pilot Scope and Review Launch' }, LOCAL),
      readableWorkstreamId({ title: 'Atlas' }, NOW),
      readableWorkstreamId({ title: '✨', intent: 'Prepare the Atlas Pilot' }, LOCAL),
      readableWorkstreamId({ title: '✨' }, LOCAL),
      long.length,
      Id.safeParse(long).success,
      Id.safeParse(collidingWorkstreamId(long, 100)).success,
      collidingWorkstreamId(readableWorkstreamId({ title: 'Launch_the-Atlas_Pilot' }, LOCAL), 2),
    ],
    expected: [
      '2025-03-15_13-30-42_Launch-the-Atlas-Pilot',
      '2025-03-15_13-30-42_Agree-the-Cafe-Pilot-Scope-and',
      '2025-03-15_18-30-00_Atlas',
      '2025-03-15_13-30-42_Prepare-the-Atlas-Pilot',
      '2025-03-15_13-30-42_Workstream',
      96,
      true,
      true,
      '2025-03-15_13-30-42_Launch-the-Atlas-Pilot-2',
    ],
  })
})

test('default store creation uses exact local time for names and UTC for metadata', async () => {
  const f = await fixture()
  try {
    const earliestId = readableWorkstreamId({ title: TITLE }, workstreamIdentityTime())
    const earliestCreated = workstreamNow()
    const work = await f.store.create({ title: TITLE })
    const latestId = readableWorkstreamId({ title: TITLE }, workstreamIdentityTime())
    const latestCreated = workstreamNow()
    assert({
      given: 'a direct store creation without an injected timestamp',
      should: 'name work with the actual local creation second while retaining UTC storage timestamps',
      actual: [
        work.id >= earliestId && work.id <= latestId,
        work.created >= earliestCreated && work.created <= latestCreated,
        work.created === work.updated,
      ],
      expected: [true, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('concurrent creation allocates numeric suffixes only when an identity or existing folder collides', async () => {
  const f = await fixture()
  try {
    const base = readableWorkstreamId({ title: TITLE }, LOCAL)
    await mkdir(path.join(f.store.dir, base), { recursive: true })
    const other = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const [first, second] = await Promise.all([
      f.store.create({ title: TITLE }, NOW, { identityTime: LOCAL }),
      other.create({ title: TITLE }, NOW, { identityTime: LOCAL }),
    ])
    const ids = [first.id, second.id].sort()
    await f.store.delete(first.id, first.revision, NOW)
    await rename(path.join(f.store.dir, first.id), path.join(f.store.dir, 'Moved-Pilot'))
    const next = await f.store.create({ title: TITLE }, NOW, { identityTime: LOCAL })
    assert({
      given: 'an occupied folder, parallel requests and a moved tombstone',
      should: 'reserve every existing identity while keeping all newly created folders distinct',
      actual: [ids, next.id, (await f.store.list()).length, (await f.store.report()).deleted.length],
      expected: [[`${base}-2`, `${base}-3`], `${base}-4`, 2, 1],
    })
  } finally {
    await f.clean()
  }
})

test('creation retries survive restart, edits and folder movement without recreating deleted work', async () => {
  const f = await fixture()
  try {
    const options = { identityTime: LOCAL, operationId: 'capture:synthetic-request' }
    const [created, retried] = await Promise.all([
      f.store.create({ title: TITLE }, NOW, options),
      f.store.create({ title: TITLE }, NOW, options),
    ])
    const edited = await f.store.put(
      { ...created, title: 'Prepare the Atlas Launch', creationOperationId: 'cannot-replace-original' },
      created.revision,
    )
    await rename(path.join(f.store.dir, created.id), path.join(f.store.dir, 'Moved-Pilot'))
    const restarted = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const lateRetry = await restarted.create({ title: 'A different retry title' }, '2025-03-16 09:00', {
      identityTime: '2025-03-16 04:00:07',
      operationId: options.operationId,
    })
    const found = await restarted.getByCreationOperation(options.operationId)
    await restarted.delete(lateRetry.id, lateRetry.revision, NOW)
    const deletedRetry = await status(() => restarted.create({ title: TITLE }, NOW, options))
    assert({
      given: 'parallel retries, later title and time changes, a restarted store, a renamed folder and deletion',
      should: 'retain the first accepted identity and creation operation, and reject resurrection',
      actual: [
        created.id === retried.id,
        edited.id === created.id,
        lateRetry.id === created.id,
        lateRetry.title,
        lateRetry.created,
        lateRetry.creationOperationId,
        lateRetry.path,
        found?.id,
        deletedRetry,
        (await restarted.list()).length,
        (await restarted.report()).deleted.length,
      ],
      expected: [
        true,
        true,
        true,
        'Prepare the Atlas Launch',
        NOW,
        options.operationId,
        path.join('workstreams', 'Moved-Pilot', 'workstream.md'),
        created.id,
        409,
        0,
        1,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('explicit imported identities remain supported and copied operation receipts refuse ambiguous retries', async () => {
  const f = await fixture()
  try {
    const original = await f.store.create({ id: 'Imported-Atlas', title: TITLE }, NOW, { operationId: 'import-atlas' })
    const copy = path.join(f.store.dir, 'Copied-Atlas', 'workstream.md')
    await mkdir(path.dirname(copy), { recursive: true })
    await writeFile(copy, await readFile(path.join(f.root, original.path), 'utf8'))
    const retried = await status(() => f.store.create({ title: TITLE }, NOW, { operationId: 'import-atlas' }))
    assert({
      given: 'an explicit imported identity whose complete file was copied',
      should: 'retain the explicit ID and prevent a duplicate retry from choosing or replacing either copy',
      actual: [original.id, retried, (await f.store.report()).errors.length],
      expected: ['Imported-Atlas', 409, 4],
    })
  } finally {
    await f.clean()
  }
})
