/**
 * Write core for streak creation — shared by the streaks:new interview and
 * the ai:chat creation tools, so every transport produces identical rule
 * docs, collision behavior, day stamps, and day items.
 */

import * as path from 'node:path'
import { DIR_STREAKS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { loadAllStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import StreakDocument, { type StreakSchedule } from '#shared/models/Streak/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import type { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export class SlugCollisionError extends Error {}
export class TitleCollisionError extends Error {}

export interface WriteStreakInput {
  /** Slugified file/entity name — the caller owns slug derivation */
  name: string
  /** Daily-checklist title — the join key in day files, unique among active streaks */
  title: string
  schedule: StreakSchedule
  /** First tracked day — may be later than the creation day */
  start: PlainDate
  /** Planned last tracked day, inclusive */
  end?: PlainDate
  why: string
  /** Freeform rules, kept verbatim below the why */
  details?: string
  tags?: TagSet
  /** Entity references (rel: vocabulary), pre-validated by the caller */
  rel?: string[]
  /** Notebook now — created/updated stamps and the day item key off it */
  now: ZonedDateTime
  /** Day-item collection, e.g. "Personal Complete" */
  category: string
}

export interface WriteStreakResult {
  file: string
  markdown: string
  dayItem: string
  /** True when the start day's Streaks list was updated */
  stamped: boolean
  /** Set when the start-day stamp failed (the rule doc itself succeeded) */
  stampWarning?: string
  /** Set when the day item could not be written (the rule doc itself succeeded) */
  dayItemWarning?: string
}

/**
 * Create the streak rule doc under active/, refusing name collisions (across
 * every status) and title collisions (among active streaks — titles are the
 * join key in day files). Stamps the start day's Streaks list and records the
 * day item on the creation day. Directory overrides exist for tests only.
 */
export async function writeStreak(
  input: WriteStreakInput,
  dirs: { streaksDir?: string; timeDir?: string } = {},
): Promise<WriteStreakResult> {
  const streaksDir = dirs.streaksDir ?? DIR_STREAKS
  const { now, start } = input

  const existing = await loadAllStreaks(streaksDir)

  const nameTaken = existing.find(({ streak }) => streak.name === input.name)
  if (nameTaken) {
    throw new SlugCollisionError(`A streak named "${input.name}" already exists (${nameTaken.status})`)
  }

  const titleTaken = existing.find(({ streak, status }) => status === 'active' && streak.title === input.title)
  if (titleTaken) {
    throw new TitleCollisionError(`Active streak "${titleTaken.streak.name}" already uses the title "${input.title}"`)
  }

  const file = path.join(streaksDir, 'active', `${input.name}.md`)
  if (await exists(file)) {
    throw new SlugCollisionError(`File already exists: ${file}`)
  }

  const streak = StreakDocument.create({
    name: input.name,
    title: input.title,
    schedule: input.schedule,
    start,
    end: input.end,
    why: input.why,
    details: input.details,
    tags: input.tags,
    rel: input.rel,
    createdOn: now.plainDateTime.date,
  })

  const markdown = streak.toMarkdown()
  await outputFile(file, markdown)

  // Stamp the start day's file so the item shows up immediately — its day
  // file may already exist even for a future start (week:new runs ahead)
  let stamped = false
  let stampWarning: string | undefined
  try {
    const dayModel = await readDay(start, dirs.timeDir)
    const stampedModel = stampStreaksList(dayModel, [streak], start)
    if (stampedModel !== dayModel) {
      await writeDay(stampedModel)
      stamped = true
    }
  } catch (err) {
    stampWarning = (err as Error).message
  }

  // Day item lands on the creation day — starting later is part of the record
  const today = now.plainDateTime.plainDate
  const startsNote = start.ymd === today.ymd ? '' : ` (starts ${start.ymd})`
  const dayItem = `${now.plainDateTime.time} > streaks/${input.name} -> Started | ${input.title}${startsNote}`
  let dayItemWarning: string | undefined
  try {
    await writeDayItems(today, input.category, dayItem, dirs.timeDir ? { timeDir: dirs.timeDir } : {})
  } catch (err) {
    dayItemWarning = (err as Error).message
  }

  return { file, markdown, dayItem, stamped, stampWarning, dayItemWarning }
}
