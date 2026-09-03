/**
 * day:items:done — strike one item in a day's lists by a few of its
 * words. The words must name exactly one pending item; ambiguity is
 * reported with the candidates rather than guessed through.
 */

import * as path from 'node:path'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { cleanItemText, findDayItem, parseListKind } from './lib/items.ts'

const params = {
  item: ArgOrFlag.string('A few words of the item to mark done', { short: 'i', required: true }),
  list: Flag.string('Restrict the search: todos, commitments, or reminders', { short: 'l', optional: true }),
  when: dayFlag({ short: 'w' }),
}

type Params = InferParams<typeof params>

type Result = { day: string; list: string; item: string; already?: true }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:items:done': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class DayItemsDoneTask extends Command {
  static override description: CommandDescription = {
    name: 'day:items:done',
    description:
      "Mark one item done (struck through) in a day's lists. Pass a few words of the item; they must match " +
      'exactly one pending item — on several matches, add words or name the list (todos, commitments, ' +
      'reminders). Defaults to today.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { item, when } = args

    let kind
    if (args.list !== undefined) {
      kind = parseListKind(args.list)
      if (!kind) return CommandResult.fail(`Unknown list "${args.list}" — use todos, commitments, or reminders.`)
    }

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    if (!(await exists(file))) {
      return CommandResult.fail(`No day file for ${when.ymd}.`)
    }

    const content = await readTextFile(file)
    const day = DayDocument.fromMarkdown(content)
    const search = findDayItem(day, item, kind)

    if (search.kind === 'none') {
      return CommandResult.fail(`No item matching "${item}" in the ${when.ymd} lists.`)
    }
    if (search.kind === 'many') {
      const shown = search.matches.map((m) => `${m.listTitle}: ${cleanItemText(m.raw)}`).join('; ')
      return CommandResult.fail(`Several items match "${item}" — ${shown}. Add words or name the list.`)
    }
    if (search.kind === 'already-done') {
      const text = cleanItemText(search.match.raw)
      output.log(`Already done: ${text}`)
      return CommandResult.success({ day: when.ymd, list: search.match.listTitle, item: text, already: true })
    }

    // The model's line edit strikes in place — the file keeps its own spelling
    // and every byte outside the one line, reference links included.
    const struck = DayDocument.toggleItem(content, search.match.listTitle, search.match.raw, true)
    if (struck.kind !== 'written') {
      return CommandResult.fail(`Could not strike "${cleanItemText(search.match.raw)}" — the day changed underneath.`)
    }
    await writeTextFile(file, struck.content)
    const text = cleanItemText(search.match.raw)
    output.log(`Done: ${text} (${search.match.listTitle})`)
    return CommandResult.success({ day: when.ymd, list: search.match.listTitle, item: text })
  }
}
