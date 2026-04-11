import { realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import makeTempDir from '#shared/fs/makeTempDir.ts'
import type { MarkdownWatcherEvent } from './mod.ts'

export { delay }

/** Create a temp dir and resolve symlinks (macOS /var → /private/var) */
export async function createTempDir(prefix: string): Promise<string> {
  const dir = await makeTempDir({ prefix })
  return realpath(dir)
}

export type { MarkdownWatcherEvent }
