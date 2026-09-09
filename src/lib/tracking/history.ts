import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { weeklyMonday } from '#commands/all/track/lib/csv.ts'
import type { TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { missingFile, safeTrackingPath } from './files.ts'
import { loadTrackingFile, type TrackingDirs } from './records.ts'
import type { TrackingEntry } from './types.ts'

/** Discover existing year/week files once, without guessing an earliest date. */
export async function trackingHistoryFiles(dirs: TrackingDirs): Promise<string[]> {
  const files: string[] = []
  const entries = async (dir: string) => {
    await safeTrackingPath(dirs.root, path.relative(dirs.root, dir))
    try {
      return await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (missingFile(error)) return []
      throw error
    }
  }
  const csvs = async (dir: string) => {
    for (const entry of await entries(dir))
      if (entry.name.endsWith('.csv') && !entry.isDirectory()) files.push(path.join(dir, entry.name))
  }
  for (const year of await entries(dirs.dataTrackingDir))
    if (/^\d{4}$/.test(year.name) && year.isDirectory()) await csvs(path.join(dirs.dataTrackingDir, year.name))

  // Stop at a recognized week: day folders, journals, and attachments aren't tracking sources.
  const weeks = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await entries(dir)) {
      if (!entry.isDirectory() || (depth === 0 && !/^\d{4}$/.test(entry.name))) continue
      const child = path.join(dir, entry.name)
      const relative = path.relative(dirs.timeDir, child)
      const week = ALL_LAYOUTS.some(
        (layout) => layout.parseTimePath(path.join('/time', relative, 'week.md'))?.kind === 'week',
      )
      if (week) {
        const tracking = path.join(child, '_tracking')
        for (const category of await entries(tracking))
          if (category.isDirectory()) await csvs(path.join(tracking, category.name))
      } else if (depth < 2) await weeks(child, depth + 1)
    }
  }
  await weeks(dirs.timeDir, 0)
  return files.sort()
}

export async function loadTrackingHistory(
  dirs: TrackingDirs,
  definition: TrackingDocument,
  files: string[],
): Promise<{ entries: TrackingEntry[]; warnings: string[] }> {
  const annual = files.filter(
    (file) => file.startsWith(dirs.dataTrackingDir + path.sep) && path.basename(file) === definition.csvBasename,
  )
  // Presence is authoritative even for a header-only or completely empty annual file.
  const annualYears = new Set(annual.map((file) => path.basename(path.dirname(file))))
  const weekly = files.filter((file) => {
    if (
      !file.startsWith(dirs.timeDir + path.sep) ||
      path.basename(file) !== definition.csvBasename ||
      path.basename(path.dirname(file)) !== (definition.category || 'health')
    )
      return false
    const monday = weeklyMonday(path.relative(dirs.timeDir, file))
    return !annualYears.has(monday.ymd.slice(0, 4)) || !annualYears.has(monday.addDays(6).ymd.slice(0, 4))
  })
  const loaded = await Promise.all([...annual, ...weekly].map((file) => loadTrackingFile(dirs, file)))
  return {
    entries: loaded
      .flatMap(
        (source) =>
          source?.entries
            .filter(
              (entry) => !source.file.startsWith(dirs.timeDir + path.sep) || !annualYears.has(entry.date.slice(0, 4)),
            )
            .map(({ line: _line, ...entry }) => entry) ?? [],
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    warnings: loaded.flatMap((source) => source?.warnings ?? []),
  }
}
