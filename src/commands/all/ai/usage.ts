import { readFile } from 'node:fs/promises'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AI_USAGE_LOG_DISPLAY, AI_USAGE_LOG_PATH } from '#shared/ai/usageLog.ts'
import { formatTokens, totalInput } from '#universal/ai/tokenUsage.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseUsageLog, recordsSince, renderTable, rollup, type UsageRow } from './lib/usageRollup.ts'

const params = {
  days: Flag.number('Days to include, counting back from today (1 = today only)', {
    short: 'd',
    default: () => 1,
  }),
}

type Params = InferParams<typeof params>
type Result = { since: string; calls: number; byModel: UsageRow[]; bySource: UsageRow[] }

export default class AiUsageTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:usage',
    description: 'Token usage by model and by command, from the usage log',
    descriptionLong: [
      'Every model call appends its token counts to the usage log:',
      `${AI_USAGE_LOG_DISPLAY}.`,
      'This rolls a day (or several) up by model and by the command that made',
      'the calls: full-rate input, input read from the cache, input written to',
      'it, output, and the share of everything read that the cache served.',
      'Tokens only — the invoice prices them by model.',
    ],
    usage: ['sky ai:usage', 'sky ai:usage --days 7'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const days = Math.max(1, Math.floor(args.days))
    const since = PlainDate.from(context.notebookNow.date).addDays(-(days - 1)).ymd

    let text = ''
    try {
      text = await readFile(AI_USAGE_LOG_PATH, 'utf8')
    } catch {
      output.log(`No usage recorded yet — the log appears at ${AI_USAGE_LOG_DISPLAY} with the first model call.`)
      return CommandResult.success({ since, calls: 0, byModel: [], bySource: [] })
    }
    const records = recordsSince(parseUsageLog(text), since)
    const byModel = rollup(records, 'model')
    const bySource = rollup(records, 'source')

    if (records.length === 0) {
      output.log(`No model calls since ${since}.`)
      return CommandResult.success({ since, calls: 0, byModel, bySource })
    }
    const read = byModel.reduce((sum, r) => sum + totalInput(r), 0)
    const out = byModel.reduce((sum, r) => sum + r.output, 0)
    output.log(
      `Since ${since}: ${records.length} model call${records.length === 1 ? '' : 's'}, ${formatTokens(read)} read, ${formatTokens(out)} out`,
    )
    output.log('')
    for (const line of renderTable('model', byModel)) output.log(line)
    output.log('')
    for (const line of renderTable('command', bySource)) output.log(line)
    return CommandResult.success({ since, calls: records.length, byModel, bySource })
  }
}
