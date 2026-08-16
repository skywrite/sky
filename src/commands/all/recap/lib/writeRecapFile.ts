import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { outputFile, readDir, readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
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
 * Human curation carried across regenerations: rel/tags are slots the user
 * fills by hand, so a re-run must not clobber them. Everything else in a
 * recap is machine-derived and regenerates freely.
 */
export async function readRecapCuration(
  day: PlainDate,
  app: string,
  timeDir = DIR_TIME,
): Promise<{ rel?: string | string[]; tags?: string }> {
  const dir = path.join(timeDir, dayDir(day), 'actions', 'recaps')
  const existing = await findExisting(dir, app)
  if (!existing) return {}

  try {
    const doc = Document.fromMarkdown(await readTextFile(existing))
    const rel = doc.yaml['rel']
    const tags = doc.yaml['tags']
    return {
      rel: Array.isArray(rel) ? (rel as string[]) : typeof rel === 'string' && rel ? rel : undefined,
      tags: typeof tags === 'string' && tags ? tags : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * Write a recap into the day's actions/recaps/, replacing any earlier recap
 * for the same app. Recaps are regenerated from the app's own record, so
 * unlike captures they are safe to overwrite — and the time prefix can shift
 * between runs as earlier activity is discovered, so replacement matches on
 * the app suffix, not the exact filename.
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
