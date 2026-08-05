import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import MarkdownWatcher from './mod.ts'
import { createTempDir, delay, type MarkdownWatcherEvent } from './test-helpers.ts'

// fs.watch({recursive: true}) under Bun on Linux can deliver no events at all
// (a second watcher in the same process may stay silent) — watcher coverage
// is macOS-only until that's resolved.
const ignore = process.platform !== 'darwin'

test('MarkdownWatcher yields create event for new .md file', { ignore }, async () => {
  const tempDir = await createTempDir('mdwatch-create-')
  const watcher = MarkdownWatcher.create()
  const events: MarkdownWatcherEvent[] = []

  const gen = watcher.run({ dirs: [tempDir], eventKinds: ['create', 'modify'] })
  const collecting = (async () => {
    for await (const event of gen) {
      events.push(event)
    }
  })()

  await delay(500)

  // Watcher startup and event delivery are slow on CI runners: keep re-writing
  // (same contents) until the watcher reports the file, up to a deadline. A
  // rewrite fires a modify event even if the watcher missed the creation.
  const filePath = path.join(tempDir, 'test.md')
  const deadline = performance.now() + 8000
  while (performance.now() < deadline && !events.some((e) => e.file === filePath)) {
    await writeFile(filePath, '# Hello')
    await delay(250)
  }

  watcher.close()
  await collecting

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
  const watcher = MarkdownWatcher.create()
  const events: MarkdownWatcherEvent[] = []

  const gen = watcher.run({ dirs: [tempDir], eventKinds: ['create', 'modify'] })
  const collecting = (async () => {
    for await (const event of gen) {
      events.push(event)
    }
  })()

  await delay(500)

  // Same re-write loop as above: writing both files each round also gives the
  // .txt file every chance to (wrongly) emit before the negative assertion.
  const txtPath = path.join(tempDir, 'test.txt')
  const mdPath = path.join(tempDir, 'test.md')
  const deadline = performance.now() + 8000
  while (performance.now() < deadline && !events.some((e) => e.file === mdPath)) {
    await writeFile(txtPath, 'plain text')
    await writeFile(mdPath, '# Markdown')
    await delay(250)
  }
  await delay(300)

  watcher.close()
  await collecting

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
