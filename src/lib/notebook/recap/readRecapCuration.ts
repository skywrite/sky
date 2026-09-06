import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayActionDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** The two hand-curated slots on a recap, as the file on disk carries them. */
export type RecapCuration = { rel?: string | string[]; tags?: string }

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
 * recap is machine-derived and regenerates freely. Matches the day's recap
 * for the app by suffix, since the time prefix can shift between runs.
 */
export default async function readRecapCuration(
  day: PlainDate,
  app: string,
  timeDir = DIR_TIME,
): Promise<RecapCuration> {
  const dir = path.join(timeDir, dayActionDir('recap', day))
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
