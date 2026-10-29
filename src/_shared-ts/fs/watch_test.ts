import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import type { FsEvent, FsEventKind, NodeWatch } from './watch.ts'
// Import the node:fs backend directly for testing (avoid Deno.watchFs in test context)
// The public watchFs export may point to any backend; we test the contract.
import { watchFs, watchFsNode } from './watch.ts'

/** A stand-in for node:fs watch: keeps each directory's listener, so a test plays events into it. */
function scriptedWatch() {
  const listeners = new Map<string, (eventType: 'rename' | 'change', filename: string | null) => void>()
  let closes = 0
  const watch: NodeWatch = (dir, _options, listener) => {
    listeners.set(dir, listener)
    return {
      close: () => {
        closes++
      },
    }
  }
  return {
    watch,
    play: (dir: string, eventType: 'rename' | 'change', filename: string | null) =>
      listeners.get(dir)?.(eventType, filename),
    closes: () => closes,
  }
}

test('watchFs reads a rename as a creation or a removal by whether the file is there, a change as a modification', async () => {
  const dir = path.resolve('/notebook')
  const script = scriptedWatch()
  const watcher = watchFsNode(dir, script.watch, (file) => file.endsWith('here.md'))
  script.play(dir, 'rename', 'here.md')
  script.play(dir, 'rename', 'gone.md')
  script.play(dir, 'change', null)
  script.play(dir, 'change', 'here.md')
  script.play(dir, 'rename', path.join('sub', 'deep', 'here.md'))
  const iterator = watcher[Symbol.asyncIterator]()
  const events: FsEvent[] = []
  for (let n = 0; n < 4; n++) events.push((await iterator.next()).value as FsEvent)
  watcher.close()
  const after = await iterator.next()

  assert({
    given:
      'a rename of a file that is there, one of a file that is gone, a nameless event, a change, and a nested rename',
    should: 'read create, remove, modify and a nested create, with absolute paths, and nothing for the nameless one',
    actual: { events, done: after.done },
    expected: {
      events: [
        { kind: 'create', paths: [path.join(dir, 'here.md')] },
        { kind: 'remove', paths: [path.join(dir, 'gone.md')] },
        { kind: 'modify', paths: [path.join(dir, 'here.md')] },
        { kind: 'create', paths: [path.join(dir, 'sub', 'deep', 'here.md')] },
      ],
      done: true,
    },
  })
})

test('watchFs watches every directory it is given, and closing stops them all', async () => {
  const time = path.resolve('/notebook/time')
  const people = path.resolve('/notebook/people')
  const script = scriptedWatch()
  const watcher = watchFsNode([time, people], script.watch, () => true)
  script.play(people, 'change', 'Jane-Doe.md')
  script.play(time, 'change', 'day.md')
  const iterator = watcher[Symbol.asyncIterator]()
  const first = (await iterator.next()).value
  const second = (await iterator.next()).value
  watcher.close()
  script.play(time, 'change', 'late.md')
  const after = await iterator.next()

  assert({
    given: 'two directories, a change in each, then a change after closing',
    should: 'report both in order, close both underlying watches, and report nothing after closing',
    actual: [first, second, after.done, script.closes()],
    expected: [
      { kind: 'modify', paths: [path.join(people, 'Jane-Doe.md')] },
      { kind: 'modify', paths: [path.join(time, 'day.md')] },
      true,
      2,
    ],
  })
})

// The tests below use the file system's own events. On a Mac they run only when asked
// (SKY_WATCH_TESTS=1): fseventsd serves every watcher on the machine, and while it is busy — a
// sync client indexing its folders, say — deliveries stall for seconds at a time. The scripted
// tests above cover the behavior on every machine.
const ignore = process.platform === 'darwin' && !env.get('SKY_WATCH_TESTS')

const PROBE = 'watcher-ready.probe'
/** How long a test waits on the watcher: macOS FSEvents batches deliveries, seconds apart under load. */
const PATIENCE_MS = 8000
/** How long one try of an action waits for its event before the action runs again. */
const TRY_MS = 2000

/** True once `condition` holds, checked every `everyMs` until `withinMs` runs out. */
async function eventually(
  condition: () => boolean | Promise<boolean>,
  everyMs = 50,
  withinMs = PATIENCE_MS,
): Promise<boolean> {
  const deadline = performance.now() + withinMs
  while (performance.now() < deadline) {
    if (await condition()) return true
    await delay(everyMs)
  }
  return condition()
}

/**
 * The events a watcher on `dir` reports for `action`. FSEvents can take seconds to start, now and
 * then a stream stays silent, and under load it drops an event: so a probe file is rewritten until
 * the watcher reports it, a silent watcher is replaced (three tries), and then the action runs again,
 * numbered, every couple of seconds until `wanted` finds what the test looks for or the patience runs out.
 */
async function collectEvents(
  dir: string,
  action: (attempt: number) => Promise<void>,
  wanted: (events: FsEvent[]) => boolean,
): Promise<FsEvent[]> {
  for (let attempt = 1; ; attempt++) {
    const watcher = watchFs(dir)
    const events: FsEvent[] = []
    let live = false
    const reading = (async () => {
      for await (const event of watcher) {
        if (event.paths.some((p) => p.endsWith(PROBE))) live = true
        else events.push(event)
      }
    })()
    const heard = await eventually(async () => {
      if (!live) await writeFile(path.join(dir, PROBE), String(performance.now()))
      return live
    }, 250)
    if (!heard && attempt < 3) {
      watcher.close()
      await reading
      continue
    }
    const deadline = performance.now() + PATIENCE_MS
    for (let n = 1; performance.now() < deadline && !wanted(events); n++) {
      await action(n)
      await eventually(() => wanted(events), 50, TRY_MS)
    }
    watcher.close()
    await reading
    return events
  }
}

/** The paths of events whose path matches `pattern`, optionally of one of `kinds`. */
function matching(events: FsEvent[], pattern: RegExp, kinds?: FsEventKind[]): string[] {
  return events.filter((e) => !kinds || kinds.includes(e.kind)).flatMap((e) => e.paths.filter((p) => pattern.test(p)))
}

test('watchFs detects file creation', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const created = /new-file-\d+\.txt$/

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      await writeFile(path.join(tmpDir, `new-file-${n}.txt`), 'hello')
    },
    (seen) => matching(seen, created, ['create']).length > 0,
  )

  assert({
    given: 'a new file created in watched directory',
    should: 'emit a create event with the file path',
    actual: matching(events, created, ['create']).length > 0,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects file modification', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const filePath = path.join(tmpDir, 'existing.txt')
  await writeFile(filePath, 'initial')

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      await writeFile(filePath, `modified ${n}`)
    },
    (seen) => matching(seen, /existing\.txt$/, ['modify', 'create']).length > 0,
  )

  assert({
    given: 'an existing file modified in watched directory',
    should: 'emit a modify or create event with the file path',
    actual: matching(events, /existing\.txt$/, ['modify', 'create']).length > 0,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects file deletion', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  await writeFile(path.join(tmpDir, 'to-delete.txt'), 'delete me')
  const removed = /to-delete(-\d+)?\.txt$/

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      // The file there from the start goes first; should its removal go unheard, another is made and removed.
      const file = path.join(tmpDir, n === 1 ? 'to-delete.txt' : `to-delete-${n}.txt`)
      if (n > 1) await writeFile(file, 'delete me')
      await unlink(file)
    },
    (seen) => matching(seen, removed, ['remove']).length > 0,
  )

  assert({
    given: 'a file deleted from watched directory',
    should: 'emit a remove event with the file path',
    actual: matching(events, removed, ['remove']).length > 0,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs detects changes in subdirectories (recursive)', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const subDir = path.join(tmpDir, 'sub', 'deep')
  await mkdir(subDir, { recursive: true })
  const nested = /nested-\d+\.txt$/

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      await writeFile(path.join(subDir, `nested-${n}.txt`), 'deep content')
    },
    (seen) => matching(seen, nested).length > 0,
  )

  assert({
    given: 'a file created in a nested subdirectory',
    should: 'detect the change recursively',
    actual: matching(events, nested).length > 0,
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

test('watchFs emits absolute paths', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const written = /abs-test-\d+\.txt$/

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      await writeFile(path.join(tmpDir, `abs-test-${n}.txt`), 'check path')
    },
    (seen) => matching(seen, written).length > 0,
  )

  const fileEvent = matching(events, written)[0]

  assert({
    given: 'a file event',
    should: 'contain an absolute path',
    actual: fileEvent !== undefined && path.isAbsolute(fileEvent),
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})

test('watchFs event kinds are valid FsEventKind values', { ignore }, async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'watch-test-'))
  const validKinds: FsEventKind[] = ['create', 'modify', 'remove', 'access', 'other']

  const events = await collectEvents(
    tmpDir,
    async (n) => {
      const f = path.join(tmpDir, `kinds-test-${n}.txt`)
      await writeFile(f, 'first')
      await delay(50)
      await writeFile(f, 'second')
      await delay(50)
      await unlink(f)
    },
    (seen) => matching(seen, /kinds-test-\d+\.txt$/).length > 0,
  )

  const allKindsValid = events.every((e) => validKinds.includes(e.kind))

  assert({
    given: 'various file operations',
    should: 'emit only valid FsEventKind values',
    actual: allKindsValid,
    expected: true,
  })

  await rm(tmpDir, { recursive: true })
})
