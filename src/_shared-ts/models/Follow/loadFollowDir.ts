import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import Follow from './mod.ts'
import type { StoreError } from '../Store/types.ts'

export type FollowFileEntry = { follow: Follow; path: string }

export type LoadFollowDirResult = {
  byFile: Map<string, FollowFileEntry>
  errors: StoreError[]
}

export async function loadFollowDir(dir: string): Promise<LoadFollowDirResult> {
  const byFile = new Map<string, FollowFileEntry>()
  const errors: StoreError[] = []

  for await (const entry of walk(dir, { exts: ['.yaml', '.yml'], includeDirs: false })) {
    try {
      const contents = await readTextFile(entry.path)
      const follow = Follow.fromYaml(contents)
      const fileName = path.basename(entry.path, path.extname(entry.path))
      byFile.set(fileName, { follow, path: entry.path })
    } catch (err) {
      errors.push({
        path: entry.path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { byFile, errors }
}
