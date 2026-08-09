/**
 * Write core for decision creation — shared by the decisions:new interview
 * and the ai:chat creation tools, so every transport produces identical
 * files, day items, and collision behavior.
 */

import * as path from 'node:path'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDate, PlainDateTime, type ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export class SlugCollisionError extends Error {}

/**
 * Mirror of DecisionDocument's target parsing ("YYYY-MM-DD" or
 * "YYYY-MM-DD HH:MM") — a value that fails here would be written to YAML
 * only to silently read back as undefined ever after.
 */
export function isParseableTarget(value: string): boolean {
  try {
    if (value.includes(' ')) new PlainDateTime(value)
    else new PlainDate(value)
    return true
  } catch {
    return false
  }
}

export interface WriteDecisionInput {
  /** Slugified file/entity name — the caller owns slug derivation */
  name: string
  title: string
  /** Markdown narrative for the document body */
  context: string
  desiredOutcomes: string
  /** Pre-validated "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" */
  target?: string
  tags?: TagSet
  /** Entity references (rel: vocabulary), pre-validated by the caller */
  rel?: string[]
  /** Notebook now — identified, created/updated, path, and day item all key off it */
  now: ZonedDateTime
  /** Day-item collection, e.g. "Professional Complete" */
  category: string
}

export interface WriteDecisionResult {
  file: string
  markdown: string
  dayItem: string
  /** Set when the day item could not be written (the document itself succeeded) */
  dayItemWarning?: string
}

/**
 * Create the decision document under pending/, refuse slug collisions, and
 * record the day item. Directory overrides exist for tests only.
 */
export async function writeDecision(
  input: WriteDecisionInput,
  dirs: { decisionsDir?: string; timeDir?: string } = {},
): Promise<WriteDecisionResult> {
  const decisionsDir = dirs.decisionsDir ?? DIR_DECISIONS
  const { now } = input

  const year = now.plainDateTime.plainDate.year
  const month = String(now.plainDateTime.plainDate.month).padStart(2, '0')
  const file = path.join(decisionsDir, String(year), 'pending', month, `${input.name}.md`)

  if (await exists(file)) {
    throw new SlugCollisionError(`A decision named "${input.name}" already exists this month: ${file}`)
  }

  const decision = DecisionDocument.create({
    name: input.name,
    identified: now,
    target: input.target,
    title: input.title,
    context: input.context,
    desiredOutcomes: input.desiredOutcomes,
    tags: input.tags,
    rel: input.rel,
  })

  const markdown = decision.toMarkdown()
  await outputFile(file, markdown)

  const dayItem = `${now.plainDateTime.time} > decisions/${input.name} -> Identified | ${input.title}`
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
