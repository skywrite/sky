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

import * as path from 'node:path'
import { readdir } from 'node:fs/promises'
import { exists } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
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
 * Extract the date and below-day sub-path from a time/ path in any of the
 * historical day-directory schemes:
 *
 *   time/2026/03/02-08/03-04/…   week range + MM-DD day
 *   time/2025/05/05-11/10/…      week range + bare DD day
 *   time/2026/07/W31/07.27/…     week number + MM.DD day
 */
export function parseOldDayPath(rel: string): { ymd: string; subpath: string } | null {
  const segs = rel.split('/')
  if (segs.length < 6 || segs[0] !== 'time') return null

  const year = Number(segs[1])
  const month = Number(segs[2])
  const day = segs[4]
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null

  let m = month
  let d: number
  const monthDay = day.match(/^(\d{2})[-.](\d{2})$/)
  if (monthDay) {
    m = Number(monthDay[1])
    d = Number(monthDay[2])
  } else if (/^\d{1,2}$/.test(day)) {
    d = Number(day)
  } else {
    return null
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  return { ymd: `${year}-${pad(m)}-${pad(d)}`, subpath: segs.slice(5).join('/') }
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
