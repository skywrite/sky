import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import { exists, readDir } from '#shared/fs/mod.ts'
import { env } from '#shared/sys/mod.ts'

export interface DesktopCandidate {
  /** Absolute file path */
  path: string
  /** Modification time in epoch milliseconds */
  mtimeMs: number
  /** Inode change time in epoch milliseconds — moves when the file arrives or is renamed */
  ctimeMs: number
}

/**
 * Sort candidates newest-first by ctime, falling back to mtime and then path so the
 * order stays deterministic when timestamps collide (e.g. files from one batch copy).
 *
 * ctime answers "when did this land here", which is what dropping a file on the Desktop
 * means. A move preserves the mtime the file was captured with, so a recording made an
 * hour ago and moved in just now loses an mtime race against anything written in between.
 * Writing bumps both stamps, so the two only disagree when the mtime predates arrival —
 * a move, a `cp -p`, or the Desktop's own YYYY-MM-DD_ prefix rename.
 */
export function sortNewestFirst(candidates: readonly DesktopCandidate[]): DesktopCandidate[] {
  return [...candidates].sort((a, b) => b.ctimeMs - a.ctimeMs || b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
}

/**
 * Files on the Desktop with one of `extensions` (lowercase, dot included), most
 * recently arrived first. Empty when HOME is unset or there is no Desktop directory.
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
      const { mtimeMs, ctimeMs } = await stat(filePath)
      candidates.push({ path: filePath, mtimeMs, ctimeMs })
    } catch {
      // File vanished between readDir and stat — skip it
    }
  }

  return sortNewestFirst(candidates)
}
