import { assert, test } from '#test'
import { rm, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import MarkdownWatcher from './mod.ts'
import { createTempDir, delay, type MarkdownWatcherEvent } from './test-helpers.ts'

test('MarkdownWatcher yields remove event for deleted .md file', async () => {
  const tempDir = await createTempDir('mdwatch-remove-')

  // Create file before starting watcher
  const filePath = path.join(tempDir, 'to-delete.md')
  await writeFile(filePath, '# Will be deleted')

  const watcher = MarkdownWatcher.create()
  const events: MarkdownWatcherEvent[] = []

  const gen = watcher.run({ dirs: [tempDir], eventKinds: ['create', 'modify', 'remove'] })
  const collecting = (async () => {
    for await (const event of gen) {
      events.push(event)
    }
  })()

  await delay(500)

  // Delete the file
  await unlink(filePath)

  await delay(1000)

  watcher.close()
  await collecting

  const removeEvents = events.filter((e) => e.file === filePath && e.event === 'remove')

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
