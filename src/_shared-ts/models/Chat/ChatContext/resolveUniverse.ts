/**
 * Resolve a resumed chat's recorded context universe against the current
 * notebook. Recorded paths go stale two ways: day directories have been
 * renamed across scheme migrations (the bulk), and files get archived into
 * new folder structures. Resolution tries, in order:
 *
 *   1. the recorded path as-is
 *   2. for time/ paths — re-derive the day directory from the date encoded
 *      in the old path and keep the sub-path below the day
 *   3. the file with the same basename whose path shares the longest
 *      trailing-segment run with the recorded path (unique winner only)
 *
 * Anything still unresolved is reported, never silently dropped.
 */

import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import { dayDir, toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface UniverseResolution {
  /** Notebook-relative paths that resolved, first-seen order, deduped */
  resolved: string[]
  /** How many resolved via day-directory re-derivation */
  remapped: number
  /** How many resolved via basename suffix matching */
  suffixMatched: number
  /** Recorded paths nothing could be found for */
  unresolved: string[]
}

/**
 * Extract the date and below-day sub-path from a time/ path in any layout
 * the notebook has ever written, via toTimeRef — the canonical
 * historical-path parser (v1.1 week ranges, legacy DD/xDD days, v2 week
 * dirs, including v1.1's year-boundary artifacts).
 */
export function parseOldDayPath(rel: string): { ymd: string; subpath: string } | null {
  let ref: string
  try {
    ref = toTimeRef(rel)
  } catch {
    return null
  }
  const ymd = ref.slice(0, 10)
  const subpath = ref.slice(11)
  return subpath ? { ymd, subpath } : null
}

/** Count common trailing path segments of two relative paths. */
export function commonSuffixSegments(a: string, b: string): number {
  const as = a.split('/')
  const bs = b.split('/')
  let n = 0
  while (n < as.length && n < bs.length && as[as.length - 1 - n] === bs[bs.length - 1 - n]) n++
  return n
}

async function buildBasenameIndex(baseDir: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>()
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) {
        const list = index.get(e.name) ?? []
        list.push(path.relative(baseDir, p))
        index.set(e.name, list)
      }
    }
  }
  await walk(baseDir)
  return index
}

export async function resolveUniverse(universePaths: string[], baseDir: string): Promise<UniverseResolution> {
  const resolved = new Set<string>()
  const unresolved: string[] = []
  let remapped = 0
  let suffixMatched = 0
  let index: Map<string, string[]> | null = null

  for (const rel of universePaths) {
    if (await exists(path.join(baseDir, rel))) {
      resolved.add(rel)
      continue
    }

    if (rel.startsWith('time/')) {
      const parsed = parseOldDayPath(rel)
      if (parsed) {
        const candidate = path.join('time', dayDir(new PlainDate(parsed.ymd)), parsed.subpath)
        if (await exists(path.join(baseDir, candidate))) {
          resolved.add(candidate)
          remapped++
          continue
        }
      }
    }

    index ??= await buildBasenameIndex(baseDir)
    const candidates = index.get(path.basename(rel)) ?? []
    let best: string | null = null
    let bestScore = 1 // a bare basename match (score 1) is too weak to trust
    let tied = false
    for (const c of candidates) {
      const score = commonSuffixSegments(rel, c)
      if (score > bestScore) {
        best = c
        bestScore = score
        tied = false
      } else if (score === bestScore && best !== null) {
        tied = true
      }
    }
    if (best && !tied) {
      resolved.add(best)
      suffixMatched++
    } else {
      unresolved.push(rel)
    }
  }

  return { resolved: [...resolved], remapped, suffixMatched, unresolved }
}
