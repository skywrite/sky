import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { outputFile, readDir } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

async function findExisting(dir: string, app: string): Promise<string | null> {
  try {
    for await (const entry of readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(`_${app}.md`)) return path.join(dir, entry.name)
    }
  } catch {
    // Directory doesn't exist yet
  }
  return null
}

/**
 * Write a recap into the day's actions/recaps/, replacing any earlier recap
 * for the same app. Recaps are regenerated from the app's own record, so
 * unlike captures they are safe to overwrite — and the time prefix can shift
 * between runs as earlier activity is discovered, so replacement matches on
 * the app suffix, not the exact filename. The hand-curated slots are read
 * back beforehand by lib/notebook/recap/readRecapCuration.ts.
 */
export default async function writeRecapFile(opts: {
  day: PlainDate
  app: string
  /** Filename time prefix, e.g. "09-12" (the day's first event). */
  prefix: string
  contents: string
  timeDir?: string
}): Promise<string> {
  const { day, app, prefix, contents, timeDir = DIR_TIME } = opts
  const dir = path.join(timeDir, dayDir(day), 'actions', 'recaps')

  const existing = await findExisting(dir, app)
  if (existing) await rm(existing)

  const file = path.join(dir, `${prefix}_${app}.md`)
  await outputFile(file, contents)
  return file
}
