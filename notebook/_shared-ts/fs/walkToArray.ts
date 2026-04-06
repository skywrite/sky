import walk, { type WalkEntry, type WalkOptions } from './walk.ts'

export type { WalkEntry, WalkOptions }

export default async function walkToArray(dirs: string | string[], options: WalkOptions = {}): Promise<WalkEntry[]> {
  if (typeof dirs === 'string') dirs = [dirs]

  // Default to not including directories (matches original behavior)
  const opts = { includeDirs: false, ...options }

  const files: WalkEntry[] = []
  for (const dir of dirs) {
    for await (const entry of walk(dir, opts)) {
      files.push(entry)
    }
  }

  return files
}
