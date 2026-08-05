// @ts-nocheck — contains Deno backend with Deno.* globals that tsc/tsgo can't resolve
/**
 * Cross-runtime file watcher abstraction.
 *
 * Backends:
 *   - node:fs watch  (current — cross-runtime, uses native FSEvents on macOS)
 *   - chokidar       (cross-runtime, but v4+ dropped fsevents, uses kqueue on macOS)
 *   - Deno.watchFs   (Deno-only)
 */

import { existsSync } from 'node:fs'
import { watch as fsWatch, type WatchEventType } from 'node:fs'
import * as path from 'node:path'

export type FsEventKind = 'create' | 'modify' | 'remove' | 'access' | 'other'

export interface FsEvent {
  kind: FsEventKind
  paths: string[]
}

export interface FsWatcher extends AsyncIterable<FsEvent> {
  close(): void
}

// ── node:fs watch backend ────────────────────────────────────────────
//
// Uses fs.watch with { recursive: true } (Node 19.1+, Bun).
// On macOS this uses the native FSEvents API via libuv — efficient for
// large directory trees, zero npm dependencies.

function watchFsNode(paths: string | string[]): FsWatcher {
  const dirs = Array.isArray(paths) ? paths : [paths]

  const queue: FsEvent[] = []
  let resolve: (() => void) | null = null
  let closed = false

  function push(kind: FsEventKind, filePath: string) {
    queue.push({ kind, paths: [filePath] })
    if (resolve) {
      resolve()
      resolve = null
    }
  }

  const watchers = dirs.map((dir) =>
    fsWatch(dir, { recursive: true }, (eventType: WatchEventType, filename: string | null) => {
      if (closed || !filename) return

      const fullPath = path.resolve(dir, filename)

      if (eventType === 'change') {
        push('modify', fullPath)
      } else if (eventType === 'rename') {
        // 'rename' fires for create, delete, and rename — check existence to disambiguate
        push(existsSync(fullPath) ? 'create' : 'remove', fullPath)
      }
    }),
  )

  return {
    close() {
      closed = true
      for (const w of watchers) w.close()
      if (resolve) {
        resolve()
        resolve = null
      }
    },

    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<FsEvent>> {
          while (!closed) {
            if (queue.length > 0) {
              return { done: false, value: queue.shift()! }
            }
            await new Promise<void>((r) => {
              resolve = r
            })
          }
          return { done: true, value: undefined }
        },
      }
    },
  }
}

// ── Deno backend ──────────────────────────────────────────────────────

function watchFsDeno(paths: string | string[]): FsWatcher {
  const watcher = Deno.watchFs(paths)

  return {
    close() {
      watcher.close()
    },

    [Symbol.asyncIterator]() {
      const inner = watcher[Symbol.asyncIterator]()
      return {
        async next() {
          const result = await inner.next()
          if (result.done) return { done: true as const, value: undefined }
          const event: FsEvent = {
            kind: result.value.kind as FsEventKind,
            paths: result.value.paths,
          }
          return { done: false as const, value: event }
        },
      }
    },
  }
}

// ── chokidar backend ─────────────────────────────────────────────────
//
// chokidar v4+ dropped fsevents, so it uses kqueue on macOS (less efficient).
// In Deno, chokidar can't load native addons at all and falls back to polling.
// Kept here for reference; prefer the node:fs backend for new deployments.

import { watch as chokidarWatch } from 'chokidar'

function watchFsChokidar(paths: string | string[]): FsWatcher {
  const watcher = chokidarWatch(paths, { ignoreInitial: true })

  const queue: FsEvent[] = []
  let resolve: (() => void) | null = null

  function push(kind: FsEventKind, filePath: string) {
    queue.push({ kind, paths: [filePath] })
    if (resolve) {
      resolve()
      resolve = null
    }
  }

  watcher
    .on('add', (p: string) => push('create', p))
    .on('change', (p: string) => push('modify', p))
    .on('unlink', (p: string) => push('remove', p))
    .on('addDir', (p: string) => push('create', p))
    .on('unlinkDir', (p: string) => push('remove', p))

  let closed = false

  return {
    close() {
      closed = true
      watcher.close()
      if (resolve) {
        resolve()
        resolve = null
      }
    },

    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<FsEvent>> {
          while (!closed) {
            if (queue.length > 0) {
              return { done: false, value: queue.shift()! }
            }
            await new Promise<void>((r) => {
              resolve = r
            })
          }
          return { done: true, value: undefined }
        },
      }
    },
  }
}

// ── public API ────────────────────────────────────────────────────────

// Active backend — node:fs watch with recursive: true (FSEvents on macOS, zero deps)
export const watchFs: (paths: string | string[]) => FsWatcher = watchFsNode

// Alternative backends (uncomment to switch):
// export const watchFs: (paths: string | string[]) => FsWatcher = watchFsDeno
// export const watchFs: (paths: string | string[]) => FsWatcher = watchFsChokidar

// Suppress unused warnings — backends are swapped by commenting/uncommenting
void watchFsDeno
void watchFsChokidar
