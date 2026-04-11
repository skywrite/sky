import { readdir } from 'node:fs/promises'

export interface DirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

export default async function* readDir(path: string): AsyncIterable<DirEntry> {
  const entries = await readdir(path, { withFileTypes: true })

  for (const entry of entries) {
    yield {
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    }
  }
}
