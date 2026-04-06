import { readdir } from 'node:fs/promises'
import * as path from 'node:path'

export interface WalkEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

export interface WalkOptions {
  /** Include directories in the output. Default: true */
  includeDirs?: boolean
  /** Filter by file extensions (e.g., ['.md', '.txt']). Only applies to files. */
  exts?: string[]
  /** Maximum depth to recurse. Default: Infinity */
  maxDepth?: number
  /** Skip directories matching these names or patterns */
  skip?: (string | RegExp)[]
}

export default async function* walk(root: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry, void, unknown> {
  const { includeDirs = true, exts, maxDepth = Infinity, skip = [] } = options

  yield* walkDir(root, 0)

  function shouldSkip(entryPath: string, patterns: (string | RegExp)[]): boolean {
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        if (entryPath.includes(pattern)) return true
      } else {
        if (pattern.test(entryPath)) return true
      }
    }
    return false
  }

  async function* walkDir(dir: string, depth: number): AsyncGenerator<WalkEntry, void, unknown> {
    if (depth > maxDepth) return

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // Directory doesn't exist or can't be read
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      const isDirectory = entry.isDirectory()
      const isFile = entry.isFile()
      const isSymlink = entry.isSymbolicLink()

      // Skip specified directories
      if (isDirectory && shouldSkip(entryPath, skip)) {
        continue
      }

      // Yield directory entries if includeDirs is true
      if (isDirectory && includeDirs) {
        yield {
          name: entry.name,
          path: entryPath,
          isFile: false,
          isDirectory: true,
          isSymlink,
        }
      }

      // Yield file entries, filtered by extension if specified
      if (isFile) {
        if (exts) {
          const ext = path.extname(entry.name).toLowerCase()
          if (!exts.includes(ext)) continue
        }
        yield {
          name: entry.name,
          path: entryPath,
          isFile: true,
          isDirectory: false,
          isSymlink,
        }
      }

      // Recurse into directories
      if (isDirectory) {
        yield* walkDir(entryPath, depth + 1)
      }
    }
  }
}
