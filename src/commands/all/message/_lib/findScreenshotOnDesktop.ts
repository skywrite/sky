import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_INPUT } from '#config'
import { exists, readDir } from '#shared/fs/mod.ts'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic'])

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

/** Return all image files in the input dir (default: ~/Desktop), sorted by modification time (capture order). */
export async function findScreenshotsOnDesktop(): Promise<string[]> {
  if (!(await exists(DIR_INPUT))) return []

  const images: { path: string; mtime: number }[] = []

  for await (const entry of readDir(DIR_INPUT)) {
    if (!entry.isFile || !isImageFile(entry.name)) continue
    const fullPath = path.join(DIR_INPUT, entry.name)
    const info = await stat(fullPath)
    images.push({ path: fullPath, mtime: info.mtimeMs ?? 0 })
  }

  // Not by name: macOS 12-hour screenshot names misorder lexicographically ("1.05 PM" < "11.00 AM")
  images.sort((a, b) => a.mtime - b.mtime)
  return images.map((i) => i.path)
}
