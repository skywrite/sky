import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import walk from '#shared/fs/walk.ts'
// Imported directly from watch.ts, not fs/mod.ts — see fs/mod.ts for why
import { type FsEventKind, type FsWatcher, watchFs } from '#shared/fs/watch.ts'
import * as config from '#shared/config.ts'

type MarkdownWatcherEventKind = FsEventKind

export type MarkdownWatcherEvent = {
  event?: MarkdownWatcherEventKind
  contents?: string
  file?: string
  error?: Error
}

export interface MarkdownWatcherOptions {
  eventKinds?: MarkdownWatcherEventKind[]
  dirs?: string[]
}

const _defaultRunOptions: MarkdownWatcherOptions = { eventKinds: ['modify', 'create', 'remove'] }

export default class MarkdownWatcher {
  private static instance: MarkdownWatcher
  private _watcher: FsWatcher | null = null

  private constructor() {}

  public static getInstance(): MarkdownWatcher {
    if (!MarkdownWatcher.instance) {
      MarkdownWatcher.instance = new MarkdownWatcher()
    }
    return MarkdownWatcher.instance
  }

  /** Create a new non-singleton instance (for testing) */
  public static create(): MarkdownWatcher {
    return new MarkdownWatcher()
  }

  public close(): void {
    this._watcher?.close()
    this._watcher = null
  }

  public async *run(options = _defaultRunOptions): AsyncGenerator<MarkdownWatcherEvent, void, unknown> {
    async function readFile(file: string): Promise<string> {
      const contents = await fs.readFile(file, { encoding: 'utf-8' })
      return contents
    }

    async function walkDirs(dirs: string[]): Promise<Map<string, string>> {
      const files = new Map<string, string>()

      for (const dir of dirs) {
        for await (const entry of walk(dir)) {
          if (path.extname(entry.path) !== '.md') continue
          files.set(entry.path, await readFile(entry.path))
        }
      }

      return files
    }

    const { eventKinds, dirs: customDirs } = options

    const dirs: string[] = []
    for (const dir of customDirs ?? config.DIRS_MARKDOWN) {
      try {
        await fs.access(dir)
        dirs.push(dir)
      } catch {
        // directory doesn't exist, skip it
      }
    }
    this._watcher = watchFs(dirs)
    for await (const event of this._watcher) {
      if (!eventKinds?.includes(event.kind)) continue

      for (const p of event.paths) {
        try {
          // For remove events, the file is gone — yield without contents
          if (event.kind === 'remove') {
            if (path.extname(p) !== '.md') continue
            yield { file: p, event: event.kind }
            continue
          }

          const statInfo = await fs.lstat(p)
          if (statInfo.isDirectory()) {
            const fileContents = await walkDirs([p])
            for (const [file, contents] of fileContents) {
              yield { file, contents, event: event.kind }
            }
            continue
          }

          if (statInfo.isFile()) {
            if (path.extname(p) !== '.md') continue
            const contents = await readFile(p)
            yield { file: p, contents, event: event.kind }
          }
        } catch (err) {
          yield { error: <Error>err }
        }
      }
    }
  }
}
