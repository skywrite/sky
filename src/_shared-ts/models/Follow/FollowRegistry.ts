import * as path from 'node:path'
import ms from 'ms'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import Follow from './mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StoreError } from '../Store/types.ts'

interface FollowEntry {
  follow: Follow
  path: string
  fileName: string
}

export default class FollowRegistry {
  private byFile: Map<string, { follow: Follow; path: string }> = new Map()
  private _errors: StoreError[] = []

  private constructor() {}

  static async build(dir: string): Promise<FollowRegistry> {
    const registry = new FollowRegistry()

    for await (const entry of walk(dir, { exts: ['.yaml', '.yml'], includeDirs: false })) {
      try {
        const contents = await readTextFile(entry.path)
        const follow = Follow.fromYaml(contents)
        const fileName = path.basename(entry.path, path.extname(entry.path))
        registry.byFile.set(fileName, { follow, path: entry.path })
      } catch (err) {
        registry._errors.push({
          path: entry.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return registry
  }

  getAll(): FollowEntry[] {
    return Array.from(this.byFile.entries()).map(([fileName, { follow, path: filePath }]) => ({
      follow,
      path: filePath,
      fileName,
    }))
  }

  getActive(): FollowEntry[] {
    return this.getAll().filter((e) => e.follow.status === 'active')
  }

  getDue(now: PlainDateTime): FollowEntry[] {
    return this.getActive().filter((e) => {
      const { follow } = e
      if (!follow.lastChecked) return true

      const intervalMs = ms(follow.checkInterval as ms.StringValue)
      if (intervalMs === undefined) return false

      const lastCheckedMs = follow.lastChecked.toTimeDateValue().getTime()
      const nowMs = now.toTimeDateValue().getTime()
      return nowMs - lastCheckedMs >= intervalMs
    })
  }

  findByFileName(name: string): { follow: Follow; path: string } | undefined {
    return this.byFile.get(name)
  }

  get size(): number {
    return this.byFile.size
  }

  get errors(): StoreError[] {
    return this._errors
  }
}
