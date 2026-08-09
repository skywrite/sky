/**
 * Write core for idea creation — shared by the ideas:new interview and the
 * ai:chat creation tools, so every transport produces identical files, day
 * items, and collision behavior.
 */

import * as path from 'node:path'
import { DIR_IDEAS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import IdeaDocument from '#shared/models/Idea/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export class SlugCollisionError extends Error {}

export interface WriteIdeaInput {
  /** Slugified file/entity name — the caller owns slug derivation */
  name: string
  title: string
  /** Markdown body under the title heading */
  body: string
  tags?: TagSet
  /** Entity references (rel: vocabulary), pre-validated by the caller */
  rel?: string[]
  /** Notebook now — created/updated, path, and day item all key off it */
  now: ZonedDateTime
  /** Day-item collection, e.g. "Professional Complete" */
  category: string
}

export interface WriteIdeaResult {
  file: string
  markdown: string
  dayItem: string
  /** Set when the day item could not be written (the document itself succeeded) */
  dayItemWarning?: string
}

/**
 * Create the idea document under draft/, refuse slug collisions, and record
 * the day item. Directory overrides exist for tests only.
 */
export async function writeIdea(
  input: WriteIdeaInput,
  dirs: { ideasDir?: string; timeDir?: string } = {},
): Promise<WriteIdeaResult> {
  const ideasDir = dirs.ideasDir ?? DIR_IDEAS
  const { now } = input

  const year = now.plainDateTime.plainDate.year
  const month = String(now.plainDateTime.plainDate.month).padStart(2, '0')
  const file = path.join(ideasDir, String(year), 'draft', month, `${input.name}.md`)

  if (await exists(file)) {
    throw new SlugCollisionError(`An idea named "${input.name}" already exists this month: ${file}`)
  }

  const idea = IdeaDocument.create({
    name: input.name,
    title: input.title,
    body: input.body,
    tags: input.tags,
    rel: input.rel,
    createdOn: now.plainDateTime.date,
  })

  const markdown = idea.toMarkdown()
  await outputFile(file, markdown)

  const dayItem = `${now.plainDateTime.time} > ideas/${input.name} -> New idea | ${input.title}`
  let dayItemWarning: string | undefined
  try {
    await writeDayItems(
      now.plainDateTime.plainDate,
      input.category,
      dayItem,
      dirs.timeDir ? { timeDir: dirs.timeDir } : {},
    )
  } catch (err) {
    dayItemWarning = (err as Error).message
  }

  return { file, markdown, dayItem, dayItemWarning }
}
