import { readdirSync } from 'node:fs'

export interface DirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

export default function* readDirSync(path: string): Iterable<DirEntry> {
  const entries = readdirSync(path, { withFileTypes: true })

  for (const entry of entries) {
    yield {
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    }
  }
}
