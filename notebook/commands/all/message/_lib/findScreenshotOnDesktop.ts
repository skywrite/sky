import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import { exists, readDir } from '#shared/fs/mod.ts'
import { env } from '#shared/sys/mod.ts'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic'])

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

/** Return all image files on ~/Desktop, sorted by name. */
export async function findScreenshotsOnDesktop(): Promise<string[]> {
  const home = env.get('HOME')
  if (!home) return []

  const desktopPath = path.join(home, 'Desktop')
  if (!(await exists(desktopPath))) return []

  const images: { path: string; mtime: number }[] = []

  for await (const entry of readDir(desktopPath)) {
    if (!entry.isFile || !isImageFile(entry.name)) continue
    const fullPath = path.join(desktopPath, entry.name)
    const info = await stat(fullPath)
    images.push({ path: fullPath, mtime: info.mtimeMs ?? 0 })
  }

  images.sort((a, b) => a.path.localeCompare(b.path))
  return images.map((i) => i.path)
}
