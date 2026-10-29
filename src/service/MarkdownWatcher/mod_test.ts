import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { FsEvent, FsEventKind, FsWatcher } from '#shared/fs/watch.ts'
import { assert, test } from '#test'
import MarkdownWatcher, { type MarkdownWatcherEvent } from './mod.ts'
import { createTempDir } from './test-helpers.ts'

/** A stand-in for the file system's events: these, in order, then nothing until it is closed. */
function scripted(events: FsEvent[]): (dirs: string[]) => FsWatcher {
  return () => {
    const queue = [...events]
    let closed = false
    let wake: (() => void) | null = null
    return {
      close() {
        closed = true
        wake?.()
      },
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<FsEvent>> {
            if (queue.length > 0) return { done: false, value: queue.shift()! }
            if (!closed)
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            return { done: true, value: undefined }
          },
        }
      },
    }
  }
}

/** The first `count` events the watcher yields for its script. */
async function yielded(
  watcher: MarkdownWatcher,
  dir: string,
  eventKinds: FsEventKind[],
  count: number,
): Promise<MarkdownWatcherEvent[]> {
  const events: MarkdownWatcherEvent[] = []
  for await (const event of watcher.run({ dirs: [dir], eventKinds })) {
    events.push(event)
    if (events.length === count) break
  }
  watcher.close()
  return events
}

test('MarkdownWatcher yields markdown with its contents, a removal without, and a new folder’s markdown', async () => {
  const dir = await createTempDir('mdwatch-scripted-')
  await writeFile(path.join(dir, 'a.md'), '# A')
  await writeFile(path.join(dir, 'b.txt'), 'plain text')
  await mkdir(path.join(dir, 'sub'))
  await writeFile(path.join(dir, 'sub', 'c.md'), '# C')
  const watcher = MarkdownWatcher.create(
    scripted([
      { kind: 'create', paths: [path.join(dir, 'a.md')] },
      { kind: 'create', paths: [path.join(dir, 'b.txt')] },
      { kind: 'modify', paths: [path.join(dir, 'a.md')] },
      { kind: 'remove', paths: [path.join(dir, 'gone.md')] },
      { kind: 'remove', paths: [path.join(dir, 'gone.txt')] },
      { kind: 'create', paths: [path.join(dir, 'sub')] },
    ]),
  )
  const events = await yielded(watcher, dir, ['create', 'modify', 'remove'], 4)

  assert({
    given: 'a markdown file made and changed, a text file made, a markdown and a text file removed, and a folder made',
    should:
      'yield the markdown with its contents each time, its removal without contents, the folder’s markdown, and nothing for text files',
    actual: events,
    expected: [
      { file: path.join(dir, 'a.md'), contents: '# A', event: 'create' },
      { file: path.join(dir, 'a.md'), contents: '# A', event: 'modify' },
      { file: path.join(dir, 'gone.md'), event: 'remove' },
      { file: path.join(dir, 'sub', 'c.md'), contents: '# C', event: 'create' },
    ],
  })

  await rm(dir, { recursive: true })
})

test('MarkdownWatcher yields only the kinds of event it is asked for', async () => {
  const dir = await createTempDir('mdwatch-kinds-')
  await writeFile(path.join(dir, 'a.md'), '# A')
  const watcher = MarkdownWatcher.create(
    scripted([
      { kind: 'modify', paths: [path.join(dir, 'a.md')] },
      { kind: 'remove', paths: [path.join(dir, 'gone.md')] },
      { kind: 'create', paths: [path.join(dir, 'a.md')] },
    ]),
  )
  const events = await yielded(watcher, dir, ['create'], 1)

  assert({
    given: 'a modification, a removal and a creation, with only creations asked for',
    should: 'yield the creation alone',
    actual: events,
    expected: [{ file: path.join(dir, 'a.md'), contents: '# A', event: 'create' }],
  })

  await rm(dir, { recursive: true })
})
