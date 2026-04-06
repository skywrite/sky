// Re-export shared riteway functionality
export { assert } from '#shared/test/riteway.ts'
export type { Assertion } from '#shared/test/riteway.ts'

// Deno-specific utilities
import * as path from 'node:path'
import { readDirSync, readTextFileSync } from '#shared/fs/mod.ts'
import dirname from '#lib/util/dirnameFilename.ts'

export function loadFixturesSync(importMetaUrl: string): Record<string, string> {
  const fileData: Record<string, string> = {}
  const { __dirname } = dirname(importMetaUrl)
  const fixturesDir = resolveFixturesDir(__dirname)

  for (const dirEntry of readDirSync(fixturesDir)) {
    if (!dirEntry.isFile) continue

    fileData[dirEntry.name] = readTextFileSync(path.join(fixturesDir, dirEntry.name))
  }

  return fileData
}

function resolveFixturesDir(dir: string): string {
  for (const name of ['fixtures', '_fixtures']) {
    const candidate = path.join(dir, name)
    try {
      // readDirSync is a generator — must iterate to trigger the underlying readdirSync
      for (const _ of readDirSync(candidate)) break
      return candidate
    } catch {
      // not found, try next
    }
  }
  throw new Error(`No fixtures/ or _fixtures/ directory found in ${dir}`)
}
