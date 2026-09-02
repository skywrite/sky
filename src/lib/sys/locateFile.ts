/**
 * Finding a file on this Mac from what a browser drop carries. A drop hands
 * the page a name, a size and a modified time — never the path; browsers
 * strip it on purpose. Together the three identify the original closely
 * enough to move it instead of copying it: the modified time matches to the
 * millisecond. The folders a drop most often comes from are checked first;
 * Spotlight covers the rest of the disk when asked to.
 */

import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { runCommand } from './command.ts'

/** What the browser knows about a dropped file. */
export interface FileFacts {
  name: string
  size: number
  /** ms since the epoch, as `File.lastModified` reports it */
  lastModified: number
}

export interface Located {
  /** Absolute */
  path: string
  /** The folder it sits in, as a person would say it: "Desktop", "Downloads", "Projects" */
  where: string
}

export interface LocateOptions {
  /** Checked first, in order — the Desktop and Downloads for a drop from Finder */
  searchDirs: string[]
  /** Ask Spotlight (`mdfind`) for the name anywhere else; off unless said */
  spotlight?: boolean
}

/** Chrome reports the modified time truncated to the millisecond; a millisecond of slack covers rounding. */
export async function matchesFacts(filePath: string, facts: FileFacts): Promise<boolean> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size !== facts.size) return false
    return Math.abs(Math.floor(info.mtimeMs) - facts.lastModified) <= 1
  } catch {
    return false
  }
}

/** "Desktop" for a file on the desktop, "home folder" for one loose in the home directory. */
export function whereWord(filePath: string, homeDir = ''): string {
  const dir = path.dirname(filePath)
  if (homeDir && path.resolve(dir) === path.resolve(homeDir)) return 'home folder'
  return path.basename(dir) || dir
}

async function spotlightHits(name: string): Promise<string[]> {
  const result = await runCommand('mdfind', ['-name', name])
  if (!result.success) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && path.basename(line) === name)
}

/**
 * Every file on this Mac that could be the one dropped: same name, same size,
 * same modified time. The search folders come first, in their order, so a
 * Desktop copy outranks one Spotlight finds elsewhere. Usually one; two when
 * a Finder duplicate kept the original's modified time; none when the file
 * came from somewhere no folder holds — a mail attachment, another tab.
 */
export async function locateFile(facts: FileFacts, options: LocateOptions): Promise<Located[]> {
  const homeDir = process.env.HOME ?? ''
  const found: Located[] = []
  const seen = new Set<string>()
  const consider = async (candidate: string) => {
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) return
    seen.add(resolved)
    if (await matchesFacts(resolved, facts)) found.push({ path: resolved, where: whereWord(resolved, homeDir) })
  }
  for (const dir of options.searchDirs) await consider(path.join(dir, facts.name))
  if (options.spotlight) for (const hit of await spotlightHits(facts.name)) await consider(hit)
  return found
}
