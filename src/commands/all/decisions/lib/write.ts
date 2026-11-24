/**
 * Write core for decision creation — shared by the decisions:new interview
 * and the ai:chat creation tools, so every transport produces identical
 * files, day items, and collision behavior.
 */

import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
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

/**
 * Parse when a decision was made or first came up: "YYYY-MM-DD HH:MM", or a
 * date alone when no time is known. A bare date reads as noon, so the record
 * never sits at the edge of its day.
 */
export function parseDecisionMoment(value: string): PlainDateTime | undefined {
  const text = value.trim()
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new PlainDateTime(`${new PlainDate(text).ymd} 12:00`)
    if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(text)) return new PlainDateTime(text)
  } catch {
    // Not a real date or time
  }
  return undefined
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
  /**
   * The decision as made. Presence means the decision was already settled:
   * it lands in resolved/ with the Decision section filled and resolved
   * stamped, instead of joining the pending queue.
   */
  decision?: string
  /**
   * The made decision still binds what the person does (a rule, a freeze, a
   * quit): it lands in in-force/ with the flag set instead of resolved/.
   * Means nothing without `decision`.
   */
  inForce?: boolean
  /**
   * More of the record, as Markdown sections starting at `## `: options
   * weighed, what is expected, rules set ahead of time. Written between
   * Desired Outcomes and Decision.
   */
  record?: string
  /**
   * The open decision this call settles. Its file is replaced by the new one,
   * and the decision keeps the day it first came up: `now` is when it was made.
   */
  settles?: { file: string; identified: ZonedDateTime }
  tags?: TagSet
  /** Entity references (rel: vocabulary), pre-validated by the caller */
  rel?: string[]
  /**
   * The moment the decision belongs to — identified, created, path, and day
   * item all key off it. Notebook now, unless the decision was made earlier.
   */
  now: ZonedDateTime
  /**
   * The day the document is written, when that is later than `now`: a
   * decision recorded after the fact keeps its own day in `created`, and
   * `updated` says when the file was written.
   */
  recorded?: PlainDate
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
 * Create the decision document — under pending/ for an open decision, under
 * resolved/ when the call was already made, or under in-force/ when that made
 * call still binds what the person does — refuse slug collisions,
 * and record the day item. With `settles`, the made call takes the place of
 * the open decision's file. Directory overrides exist for tests only.
 */
export async function writeDecision(
  input: WriteDecisionInput,
  dirs: { decisionsDir?: string; timeDir?: string } = {},
): Promise<WriteDecisionResult> {
  const decisionsDir = dirs.decisionsDir ?? DIR_DECISIONS
  const { now } = input

  // A made call is a resolved decision — it never passes through pending
  const madeCall = input.decision?.trim() || undefined
  const inForce = Boolean(madeCall && input.inForce)
  const status = inForce ? DecisionDocument.IN_FORCE_DIR : madeCall ? 'resolved' : 'pending'

  const year = now.plainDateTime.plainDate.year
  const month = String(now.plainDateTime.plainDate.month).padStart(2, '0')
  const file = path.join(decisionsDir, String(year), status, month, `${input.name}.md`)

  if (await exists(file)) {
    throw new SlugCollisionError(`A decision named "${input.name}" already exists this month: ${file}`)
  }

  let doc = DecisionDocument.create({
    name: input.name,
    identified: input.settles?.identified ?? now,
    target: input.target,
    title: input.title,
    context: input.context,
    desiredOutcomes: input.desiredOutcomes,
    record: input.record,
    decision: madeCall,
    resolved: madeCall ? now : undefined,
    inForce,
    tags: input.tags,
    rel: input.rel,
  })
  if (input.recorded && input.recorded.ymd !== now.plainDateTime.plainDate.ymd) {
    doc = doc.updateYaml({ updated: input.recorded.ymd })
  }
  // A settled decision keeps the day it came up as `created`; `updated` is the day it was made.
  if (input.settles) doc = doc.updateYaml({ updated: now.plainDateTime.plainDate.ymd })

  const markdown = doc.toMarkdown()
  await outputFile(file, markdown)
  // The open decision's file goes only once the made one is safely written.
  if (input.settles && input.settles.file !== file) await rm(input.settles.file, { force: true })

  const verb = input.settles && madeCall ? 'Resolved' : madeCall ? 'Decided' : 'Identified'
  const dayItem = `${now.plainDateTime.time} > decisions/${input.name} -> ${verb} | ${input.title}`
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

export interface UpdateOpenDecisionInput {
  /** The open decision's file */
  file: string
  title: string
  context: string
  desiredOutcomes: string
  /** More of the record, as Markdown sections starting at `## ` */
  record?: string
  /** The day to decide by, "YYYY-MM-DD"; null clears it, and left out it stays as it is */
  target?: string | null
  /** References to add; the ones the file has stay, first */
  rel?: string[]
  /** The day of this write, for `updated` */
  today: PlainDate
  /**
   * The file's text as the caller last wrote it. A file that reads differently was changed by hand since,
   * and is left alone.
   */
  expected?: string
}

/**
 * Rewrite an open decision in place with its record as it stands, for a decision being worked through over
 * several sittings. Its name, the day it came up, its tags and its references are kept. A decision already
 * made is refused: its record is history.
 */
export async function updateOpenDecision(
  input: UpdateOpenDecisionInput,
): Promise<{ markdown: string; changed: boolean; edited: boolean }> {
  const current = await readTextFile(input.file)
  if (input.expected !== undefined && current !== input.expected)
    return { markdown: current, changed: false, edited: true }
  const open = DecisionDocument.fromMarkdown(current)
  if (!open.isPending) throw new Error(`The decision "${open.name}" is already made.`)
  const target = input.target === undefined ? open.target : (input.target ?? undefined)
  const markdown = DecisionDocument.create({
    name: open.name,
    identified: open.identified,
    target,
    title: input.title,
    context: input.context,
    desiredOutcomes: input.desiredOutcomes,
    record: input.record,
    tags: open.tags.size ? open.tags : undefined,
    rel: mergeRel([...open.rel], input.rel),
  })
    .updateYaml({ updated: input.today.ymd })
    .toMarkdown()
  if (markdown === current) return { markdown, changed: false, edited: false }
  await outputFile(input.file, markdown)
  return { markdown, changed: true, edited: false }
}
