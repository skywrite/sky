import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTempDir, delay, liveWatcher, PATIENCE_MS } from './test-helpers.ts'

// These use the file system's own events, so they run only when asked: SKY_WATCH_TESTS=1, on a Mac.
// fs.watch({recursive: true}) under Bun on Linux can deliver no events at all (a second watcher in
// the same process may stay silent), and on a Mac fseventsd serves every watcher on the machine:
// while it is busy — a sync client indexing its folders, say — deliveries stall for seconds.
// mod_test.ts covers the watcher's behavior with scripted events on every machine.
const ignore = process.platform !== 'darwin' || !env.get('SKY_WATCH_TESTS')

test('MarkdownWatcher yields create event for new .md file', { ignore }, async () => {
  const tempDir = await createTempDir('mdwatch-create-')
  const { events, stop } = await liveWatcher(tempDir, ['create', 'modify'])

  // Event delivery is slow on CI runners and under load: keep re-writing (same contents) until the
  // watcher reports the file, up to a deadline. A rewrite fires a modify event even if the watcher
  // missed the creation.
  const filePath = path.join(tempDir, 'test.md')
  const deadline = performance.now() + PATIENCE_MS
  while (performance.now() < deadline && !events.some((e) => e.file === filePath)) {
    await writeFile(filePath, '# Hello')
    await delay(250)
  }

  await stop()

  const fileEvents = events.filter((e) => e.file === filePath)

  assert({
    given: 'a new .md file created in watched dir',
    should: 'yield at least one event for that file',
    actual: fileEvents.length >= 1,
    expected: true,
  })

  assert({
    given: 'a new .md file created in watched dir',
    should: 'include the file contents',
    actual: fileEvents[0]?.contents,
    expected: '# Hello',
  })

  await rm(tempDir, { recursive: true })
})

test('MarkdownWatcher ignores non-.md files', { ignore }, async () => {
  const tempDir = await createTempDir('mdwatch-ignore-')
  const { events, stop } = await liveWatcher(tempDir, ['create', 'modify'])

  // Same re-write loop as above: writing both files each round also gives the
  // .txt file every chance to (wrongly) emit before the negative assertion.
  const txtPath = path.join(tempDir, 'test.txt')
  const mdPath = path.join(tempDir, 'test.md')
  const deadline = performance.now() + PATIENCE_MS
  while (performance.now() < deadline && !events.some((e) => e.file === mdPath)) {
    await writeFile(txtPath, 'plain text')
    await writeFile(mdPath, '# Markdown')
    await delay(250)
  }
  await delay(300)

  await stop()

  const txtEvents = events.filter((e) => e.file === txtPath)
  const mdEvents = events.filter((e) => e.file === mdPath)

  assert({
    given: 'a .txt file created in watched dir',
    should: 'not yield any events for it',
    actual: txtEvents.length,
    expected: 0,
  })

  assert({
    given: 'a .md file also created',
    should: 'still yield events for the .md file',
    actual: mdEvents.length >= 1,
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})
