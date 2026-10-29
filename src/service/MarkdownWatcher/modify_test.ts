import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTempDir, delay, liveWatcher, PATIENCE_MS } from './test-helpers.ts'

// See create_test.ts: these run only when asked, SKY_WATCH_TESTS=1 on a Mac; mod_test.ts covers the
// behavior with scripted events everywhere.
const ignore = process.platform !== 'darwin' || !env.get('SKY_WATCH_TESTS')

test('MarkdownWatcher yields modify event for updated .md file', { ignore }, async () => {
  const tempDir = await createTempDir('mdwatch-modify-')

  // Create file before starting watcher
  const filePath = path.join(tempDir, 'existing.md')
  await writeFile(filePath, '# Original')

  const { events, stop } = await liveWatcher(tempDir, ['create', 'modify'])

  // As in create_test.ts: deliveries come in batches, seconds apart under load. Rewrite the new
  // contents until the watcher reports them, up to a deadline.
  const deadline = performance.now() + PATIENCE_MS
  while (performance.now() < deadline && !events.some((e) => e.file === filePath && e.contents === '# Updated')) {
    await writeFile(filePath, '# Updated')
    await delay(250)
  }

  await stop()

  const fileEvents = events.filter((e) => e.file === filePath)

  assert({
    given: 'an existing .md file modified in watched dir',
    should: 'yield at least one event for that file',
    actual: fileEvents.length >= 1,
    expected: true,
  })

  assert({
    given: 'an existing .md file modified in watched dir',
    should: 'include the updated contents',
    actual: fileEvents.some((e) => e.contents === '# Updated'),
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})
