import * as path from 'node:path'
import { enrichDecision } from '#commands/all/decisions/lib/enrich.ts'
import { writeDecision } from '#commands/all/decisions/lib/write.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as ConfigModule from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** What `decisions:create` takes, as the wizard's record fills it in */
export interface DecisionCreate {
  title: string
  context: string
  desiredOutcomes: string
  /** More sections of the record, as Markdown starting at `## ` */
  record?: string
  /** What was decided; absent for a decision that is still open */
  decision?: string
  inForce: boolean
  /** "YYYY-MM-DD", when it was made on an earlier day */
  when?: string
  /** "YYYY-MM-DD", the day an open decision should be made by */
  target?: string
  rel: string[]
  category: 'Personal' | 'Professional'
}

/** A call that settles an open decision: the fields of the made decision, and the open decision's file */
export interface DecisionSettle extends Omit<DecisionCreate, 'when' | 'target'> {
  file: string
  decision: string
}

/** The writes behind the wizard's buttons */
export interface DecisionCommands {
  /** `decisions:create`: write the decision and its day line; returns the file it wrote */
  create(input: DecisionCreate): Promise<{ name: string; file: string }>
  /** The made call takes the place of an open decision's file, and keeps the day it came up */
  settle(input: DecisionSettle): Promise<{ name: string; file: string }>
  /** `day:items:add`: a to-do for a day, or a reminder that surfaces on a later one */
  addItem(input: {
    task: string
    list: 'todos' | 'reminders'
    when: string
    category: 'Personal' | 'Professional'
  }): Promise<void>
}

/**
 * Each write is the one the terminal and chat make: `decisions:create` for a
 * new decision, `day:items:add` for a to-do or a reminder, both run in-process.
 *
 * Settling an open decision has no command to run. `decisions:resolve` asks
 * for the decision at a terminal prompt, so the wizard goes through the same
 * write core that command and `decisions:create` share.
 */
export function createDecisionCommands(
  config: typeof ConfigModule,
  env: Record<string, string>,
  /** `enrich: false` saves without looking up tags and rel, for a notebook with no service behind it */
  { enrich = true }: { enrich?: boolean } = {},
): DecisionCommands {
  const createTasks = () => new CommandService(CommandContext.server(config, env))
  return {
    async create({ rel, category, ...fields }) {
      const result = await createTasks().run('decisions:create', {
        ...fields,
        rel: rel.join(';') || undefined,
        // The command's own parser turns "Personal" into the day list it writes to; an in-process run passes that form.
        category: `${category} Complete`,
        ...(enrich ? {} : { noAutoTag: true, noAutoRel: true }),
      })
      if (result.status !== 'success' || !result.data) throw new Error(result.message ?? 'The decision was not saved.')
      return { name: result.data.name, file: result.data.file }
    },
    async settle({ file, rel, category, ...fields }) {
      const open = DecisionDocument.fromMarkdown(await readTextFile(file))
      const now = await fetchNow()
      const name = open.name || path.basename(file, '.md')
      // What the open decision was already tied to and tagged with stays; the finished record can add to it,
      // as it would for a decision written in one go.
      const kept = { rel: [...new Set([...open.rel, ...rel])], tags: open.tags.size ? open.tags : undefined }
      const enriched = enrich ? await enrichDecision({ ...fields, ...kept }) : kept
      const written = await writeDecision({
        ...fields,
        name,
        rel: enriched.rel,
        tags: enriched.tags,
        now,
        category: `${category} Complete`,
        settles: { file, identified: open.identified ?? now },
      })
      return { name, file: written.file }
    },
    async addItem({ task, list, when, category }) {
      const result = await createTasks().run('day:items:add', { task, list, category, when: new PlainDate(when) })
      if (result.status !== 'success') throw new Error(result.message ?? 'The item was not added.')
    },
  }
}
