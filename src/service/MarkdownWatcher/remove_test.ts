import { rm, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTempDir, eventually, liveWatcher, PATIENCE_MS } from './test-helpers.ts'

// See create_test.ts: these run only when asked, SKY_WATCH_TESTS=1 on a Mac; mod_test.ts covers the
// behavior with scripted events everywhere.
const ignore = process.platform !== 'darwin' || !env.get('SKY_WATCH_TESTS')

test('MarkdownWatcher yields remove event for deleted .md file', { ignore }, async () => {
  const tempDir = await createTempDir('mdwatch-remove-')

  // Create file before starting watcher
  const filePath = path.join(tempDir, 'to-delete.md')
  await writeFile(filePath, '# Will be deleted')

  // A deletion cannot be repeated the way create_test.ts rewrites a file, and under load FSEvents
  // drops one now and then: should the first removal go unheard, another file is made and removed.
  const { events, stop } = await liveWatcher(tempDir, ['create', 'modify', 'remove'])
  const removed = (file: string | undefined) => /to-delete(-\d+)?\.md$/.test(file ?? '')
  const deadline = performance.now() + PATIENCE_MS
  for (let n = 1; performance.now() < deadline && !events.some((e) => removed(e.file) && e.event === 'remove'); n++) {
    const file = n === 1 ? filePath : path.join(tempDir, `to-delete-${n}.md`)
    if (n > 1) await writeFile(file, '# Will be deleted')
    await unlink(file)
    await eventually(() => events.some((e) => removed(e.file) && e.event === 'remove'), 2000)
  }
  await stop()

  const removeEvents = events.filter((e) => removed(e.file) && e.event === 'remove')

  assert({
    given: 'a .md file deleted from watched dir',
    should: 'yield a remove event for that file',
    actual: removeEvents.length >= 1,
    expected: true,
  })

  assert({
    given: 'a .md file deleted from watched dir',
    should: 'not include contents in the remove event',
    actual: removeEvents[0]?.contents,
    expected: undefined,
  })

  await rm(tempDir, { recursive: true })
})
