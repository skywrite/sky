import { realpath, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import makeTempDir from '#shared/fs/makeTempDir.ts'
import type { FsEventKind } from '#shared/fs/watch.ts'
import MarkdownWatcher, { type MarkdownWatcherEvent } from './mod.ts'

export { delay }

/** How long a test waits on the watcher: FSEvents batches its deliveries, seconds apart under load. */
export const PATIENCE_MS = 8000

/** Create a temp dir and resolve symlinks (macOS /var → /private/var) */
export async function createTempDir(prefix: string): Promise<string> {
  const dir = await makeTempDir({ prefix })
  return realpath(dir)
}

/** True once `condition` holds, checked every 100 ms until `withinMs` runs out. */
export async function eventually(condition: () => boolean, withinMs = PATIENCE_MS): Promise<boolean> {
  const deadline = performance.now() + withinMs
  while (performance.now() < deadline && !condition()) await delay(100)
  return condition()
}

export interface LiveWatcher {
  /** What the watcher yielded, the readiness probe's events left out */
  events: MarkdownWatcherEvent[]
  /** Closes the watcher and waits for its loop to end */
  stop(): Promise<void>
}

/**
 * A MarkdownWatcher on `dir` that has been heard from. FSEvents can take seconds to start, and now
 * and then a stream stays silent: a probe file is rewritten until the watcher reports it, and a
 * watcher that never does is replaced, three tries in all.
 */
export async function liveWatcher(dir: string, eventKinds: FsEventKind[]): Promise<LiveWatcher> {
  const probe = path.join(dir, 'watcher-ready.md')
  for (let attempt = 1; ; attempt++) {
    const watcher = MarkdownWatcher.create()
    const events: MarkdownWatcherEvent[] = []
    let live = false
    const collecting = (async () => {
      for await (const event of watcher.run({ dirs: [dir], eventKinds })) {
        if (event.file === probe) live = true
        else events.push(event)
      }
    })()
    const stop = async () => {
      watcher.close()
      await collecting
    }
    const deadline = performance.now() + PATIENCE_MS
    while (!live && performance.now() < deadline) {
      await writeFile(probe, `# Probe ${attempt}`)
      await delay(250)
    }
    if (live || attempt === 3) return { events, stop }
    await stop()
  }
}

export type { MarkdownWatcherEvent }
