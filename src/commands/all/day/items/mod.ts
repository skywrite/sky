/**
 * day:items — a day's lists as data: every section with its items and
 * their done state. The read half of the voice trio (items / add / done):
 * "what's on my commitments today?" is this command, not a notebook
 * search.
 */

import * as path from 'node:path'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Command, CommandResult, dayFlag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { type DayItemList, listDayItems } from './lib/items.ts'

const params = {
  when: dayFlag({ short: 'w' }),
}

type Params = InferParams<typeof params>

type Result = { day: string; lists: DayItemList[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:items': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class DayItemsTask extends Command {
  static override description: CommandDescription = {
    name: 'day:items',
    description:
      "Read a day's item lists — Most Important, Commitments, Todos, Reminders, Complete — each item with its " +
      'done state. Call it to answer what is on the lists, before marking an item done, and to confirm what ' +
      'changed. The Streaks list is retrospective (checked off the next morning) — not part of what needs ' +
      'doing today. Defaults to today.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { when } = args

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    if (!(await exists(file))) {
      return CommandResult.fail(`No day file for ${when.ymd}.`)
    }

    const day = DayDocument.fromMarkdown(await readTextFile(file))
    const lists = listDayItems(day)

    for (const list of lists) {
      output.log(`${list.title} (${list.items.length})`)
      for (const item of list.items) {
        output.log(`  ${item.done ? '✓' : '·'} ${item.text}`)
      }
    }

    return CommandResult.success({ day: when.ymd, lists })
  }
}
