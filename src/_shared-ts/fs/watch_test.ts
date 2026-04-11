import { assert, test } from '#test'
import * as path from 'node:path'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { FsEvent, FsEventKind } from './watch.ts'

// Import the node:fs backend directly for testing (avoid Deno.watchFs in test context)
// The public watchFs export may point to any backend; we test the contract.
import { watchFs } from './watch.ts'

/** Collect events for a duration then stop. */
async function collectEvents(dir: string, action: () => Promise<void>, ms = 500): Promise<FsEvent[]> {
  const watcher = watchFs(dir)
  const events: FsEvent[] = []

  // Small delay to let the watcher initialize
  await delay(100)

  await action()

  // Collect events for the given duration
  const deadline = Date.now() + ms
  const iter = watcher[Symbol.asyncIterator]()

  while (Date.now() < deadline) {
    const raceResult = await Promise.race([
      iter.next(),
      delay(Math.max(10, deadline - Date.now())).then(() => 'timeout' as const),
    ])
    if (raceResult === 'timeout') break
    const result = raceResult as IteratorResult<FsEvent>
    if (result.done) break
    events.push(result.value)
  }

  watcher.close()
  return events
}

test('watchFs detects file creation', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))

  const events = await collectEvents(tmpDir, async () => {
    await writeFile(path.join(tmpDir, 'new-file.txt'), 'hello')
  })

  const createEvents = events.filter((e) => e.kind === 'create')
  const createdPaths = createEvents.flatMap((e) => e.paths)
  const hasNewFile = createdPaths.some((p) => p.endsWith('new-file.txt'))

  assert({
    given: 'a new file created in watched directory',
    should: 'emit a create event with the file path',
    actual: hasNewFile,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects file modification', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const filePath = path.join(tmpDir, 'existing.txt')
  await writeFile(filePath, 'initial')
  // Let watcher settle after initial file creation
  await delay(200)

  const events = await collectEvents(tmpDir, async () => {
    await writeFile(filePath, 'modified')
  })

  const changePaths = events.filter((e) => e.kind === 'modify' || e.kind === 'create').flatMap((e) => e.paths)
  const hasChanged = changePaths.some((p) => p.endsWith('existing.txt'))

  assert({
    given: 'an existing file modified in watched directory',
    should: 'emit a modify or create event with the file path',
    actual: hasChanged,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects file deletion', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const filePath = path.join(tmpDir, 'to-delete.txt')
  await writeFile(filePath, 'delete me')
  await delay(200)

  const events = await collectEvents(tmpDir, async () => {
    await unlink(filePath)
  })

  const removeEvents = events.filter((e) => e.kind === 'remove')
  const removedPaths = removeEvents.flatMap((e) => e.paths)
  const hasRemoved = removedPaths.some((p) => p.endsWith('to-delete.txt'))

  assert({
    given: 'a file deleted from watched directory',
    should: 'emit a remove event with the file path',
    actual: hasRemoved,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects changes in subdirectories (recursive)', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const subDir = path.join(tmpDir, 'sub', 'deep')
  await mkdir(subDir, { recursive: true })
  await delay(200)

  const events = await collectEvents(tmpDir, async () => {
    await writeFile(path.join(subDir, 'nested.txt'), 'deep content')
  })

  const allPaths = events.flatMap((e) => e.paths)
  const hasNested = allPaths.some((p) => p.endsWith('nested.txt'))

  assert({
    given: 'a file created in a nested subdirectory',
    should: 'detect the change recursively',
    actual: hasNested,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs close stops emitting events', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const watcher = watchFs(tmpDir)

  await delay(100)
  watcher.close()

  // Write a file after close
  await writeFile(path.join(tmpDir, 'after-close.txt'), 'should not be seen')
  await delay(200)

  // The iterator should complete immediately since watcher is closed
  const iter = watcher[Symbol.asyncIterator]()
  const result = await iter.next()

  assert({
    given: 'a watcher that has been closed',
    should: 'return done: true from the iterator',
    actual: result.done,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs emits absolute paths', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))

  const events = await collectEvents(tmpDir, async () => {
    await writeFile(path.join(tmpDir, 'abs-test.txt'), 'check path')
  })

  const allPaths = events.flatMap((e) => e.paths)
  const fileEvent = allPaths.find((p) => p.endsWith('abs-test.txt'))

  assert({
    given: 'a file event',
    should: 'contain an absolute path',
    actual: fileEvent !== undefined && path.isAbsolute(fileEvent),
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs event kinds are valid FsEventKind values', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const validKinds: FsEventKind[] = ['create', 'modify', 'remove', 'access', 'other']

  const events = await collectEvents(tmpDir, async () => {
    const f = path.join(tmpDir, 'kinds-test.txt')
    await writeFile(f, 'first')
    await delay(50)
    await writeFile(f, 'second')
    await delay(50)
    await unlink(f)
  })

  const allKindsValid = events.every((e) => validKinds.includes(e.kind))

  assert({
    given: 'various file operations',
    should: 'emit only valid FsEventKind values',
    actual: allKindsValid,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})
