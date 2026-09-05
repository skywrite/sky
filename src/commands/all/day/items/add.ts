/**
 * day:items:add — one door to a day's three writable lists. Todos and
 * Reminders go through their existing commands (todos keep the
 * schedule-file fallback for days with no file yet); Commitments write
 * directly, carrying their `HH:MM >` time when one is given.
 */

import * as path from 'node:path'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, category, Command, CommandResult, dayFlag, Flag, isFailOrError } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { type DayListKind, parseListKind } from './lib/items.ts'

const params = {
  task: ArgOrFlag.string('The item text, as it should appear in the list', { short: 't', required: true }),
  list: ArgOrFlag.string('Which list: todos, commitments, or reminders', {
    short: 'l',
    position: 1,
    default: 'todos',
  }),
  category: category(),
  time: Flag.string('Clock time HH:MM for a commitment — kept as its `HH:MM >` prefix', { optional: true }),
  when: dayFlag({ short: 'w' }),
}

type Params = InferParams<typeof params>

type Result = { day: string; list: string; item: string; filed: 'day' | 'schedule' }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:items:add': { params: Params; result: Result }
  }
}

/** `9:05` → `09:05`; extended notebook hours (25:30) pass untouched. */
function normalizeTime(time: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return undefined
  if (Number(match[2]) > 59) return undefined
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

@AIChatTool({ needsApproval: false })
export default class DayItemsAddTask extends Command {
  static override description: CommandDescription = {
    name: 'day:items:add',
    description:
      "Add one item to a day's Todos, Commitments, or Reminders. Category is Personal or Professional by the " +
      "item's subject (default Professional). A commitment at a stated clock time carries it as HH:MM. Defaults " +
      'to today; a todo for a day with no file yet lands on the schedule instead.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { task, category: cat, time, when } = args

    const kind: DayListKind | undefined = parseListKind(args.list)
    if (!kind) {
      return CommandResult.fail(`Unknown list "${args.list}" — use todos, commitments, or reminders.`)
    }

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    const dayExists = await exists(file)

    if (!dayExists) {
      // Only todos have a home before the day file exists: the schedule.
      if (kind !== 'todos') {
        return CommandResult.fail(
          `No day file for ${when.ymd} yet — a todo can go to the schedule; commitments and reminders need the day started.`,
        )
      }
      const result = await tasks.run('day:todo:add', { task, category: cat, when })
      if (isFailOrError(result)) return result as CommandResult<Result>
      output.log(`Added to the schedule for ${when.ymd}: ${task}`)
      return CommandResult.success({ day: when.ymd, list: `${cat} Todos`, item: task, filed: 'schedule' })
    }

    // The DayDocument add methods create a missing list in its canonical
    // position. addItem-by-title must not be used here: on a day without
    // the list it silently appends to the LAST list (findListFromIndexOrTitle
    // resolves a missing title to index -1).
    let item = task
    let list: string
    const day = DayDocument.fromMarkdown(await readTextFile(file))
    let next: DayDocument
    if (kind === 'todos') {
      list = `${cat} Todos`
      next = day.addTodoItem(task, { category: cat })
    } else if (kind === 'reminders') {
      list = 'Reminders'
      next = day.addReminderItem(task)
    } else {
      if (time) {
        const normalized = normalizeTime(time)
        if (!normalized) return CommandResult.fail(`Not a clock time: "${time}" — use HH:MM.`)
        item = `${normalized} > ${task}`
      }
      list = `${cat} Commitments`
      next = day.addCommitmentItem(item, { category: cat })
    }
    await writeTextFile(file, next.toMarkdown())
    output.log(`Added to ${list}: ${item}`)
    return CommandResult.success({ day: when.ymd, list, item, filed: 'day' })
  }
}
