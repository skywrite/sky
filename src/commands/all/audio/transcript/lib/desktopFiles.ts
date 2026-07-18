import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import { exists, readDir } from '#shared/fs/mod.ts'
import { env } from '#shared/sys/mod.ts'

export interface DesktopCandidate {
  /** Absolute file path */
  path: string
  /** Modification time in epoch milliseconds */
  mtimeMs: number
}

/**
 * Sort candidates newest-first by mtime, ties broken by path so the order
 * stays deterministic when timestamps collide (e.g. files from one batch copy).
 */
export function sortNewestFirst(candidates: readonly DesktopCandidate[]): DesktopCandidate[] {
  return [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
}

/**
 * Files on the Desktop with one of `extensions` (lowercase, dot included),
 * newest first. Empty when HOME is unset or there is no Desktop directory.
 */
export async function desktopFilesByExt(extensions: readonly string[]): Promise<DesktopCandidate[]> {
  const home = env.get('HOME')
  if (!home) return []

  const desktopPath = path.join(home, 'Desktop')
  if (!(await exists(desktopPath))) return []

  const candidates: DesktopCandidate[] = []
  for await (const entry of readDir(desktopPath)) {
    if (!entry.isFile) continue
    if (!extensions.includes(path.extname(entry.name).toLowerCase())) continue

    const filePath = path.join(desktopPath, entry.name)
    try {
      const { mtimeMs } = await stat(filePath)
      candidates.push({ path: filePath, mtimeMs })
    } catch {
      // File vanished between readDir and stat — skip it
    }
  }

  return sortNewestFirst(candidates)
}
