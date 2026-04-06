import { assert, test } from '#test'
import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import MarkdownWatcher from './mod.ts'
import { createTempDir, delay, type MarkdownWatcherEvent } from './test-helpers.ts'

test('MarkdownWatcher yields create event for new .md file', async () => {
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

  const filePath = path.join(tempDir, 'test.md')
  await writeFile(filePath, '# Hello')

  await delay(1000)

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

test('MarkdownWatcher ignores non-.md files', async () => {
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

  const txtPath = path.join(tempDir, 'test.txt')
  await writeFile(txtPath, 'plain text')

  const mdPath = path.join(tempDir, 'test.md')
  await writeFile(mdPath, '# Markdown')

  await delay(1000)

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
