import { assert, test } from '#test'
import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import MarkdownWatcher from './mod.ts'
import { createTempDir, delay, type MarkdownWatcherEvent } from './test-helpers.ts'

test('MarkdownWatcher yields modify event for updated .md file', async () => {
  const tempDir = await createTempDir('mdwatch-modify-')

  // Create file before starting watcher
  const filePath = path.join(tempDir, 'existing.md')
  await writeFile(filePath, '# Original')

  const watcher = MarkdownWatcher.create()
  const events: MarkdownWatcherEvent[] = []

  const gen = watcher.run({ dirs: [tempDir], eventKinds: ['create', 'modify'] })
  const collecting = (async () => {
    for await (const event of gen) {
      events.push(event)
    }
  })()

  await delay(500)

  await writeFile(filePath, '# Updated')

  await delay(1000)

  watcher.close()
  await collecting

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
