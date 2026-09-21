import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, category, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { fileTaskItems } from '#lib/nbfs/fileTaskItems.ts'
import { commandPlanningDate } from '#lib/nbfs/taskDestination.ts'
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
      'to today; dates beyond this week go to the schedule, preserving the item type.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { task, category: cat, time, when } = args

    const kind: DayListKind | undefined = parseListKind(args.list)
    if (!kind) {
      return CommandResult.fail(`Unknown list "${args.list}" — use todos, commitments, or reminders.`)
    }

    let item = task
    if (kind === 'commitments' && time) {
      const normalized = normalizeTime(time)
      if (!normalized) return CommandResult.fail(`Not a clock time: "${time}" — use HH:MM.`)
      item = `${normalized} > ${task}`
    }
    const list = kind === 'reminders' ? 'Reminders' : `${cat} ${kind === 'todos' ? 'Todos' : 'Commitments'}`
    const filed = await fileTaskItems(config, commandPlanningDate(context), when, list, [item])
    output.log(filed === 'schedule' ? `Scheduled for ${when.ymd}: ${item}` : `Added to ${list}: ${item}`)
    return CommandResult.success({ day: when.ymd, list, item, filed })
  }
}
