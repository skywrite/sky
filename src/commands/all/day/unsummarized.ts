import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'
import { configured, FILE_DAY, layoutByPattern } from '#shared/nbfs/layout/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

type Result = { days: string[]; currentDay: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:unsummarized': { params: Record<string, never>; result: Result }
  }
}

/** Stop at day directories instead of descending into their chats, meetings, and attachments. */
async function* dayFiles(dir: string, depth: number): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (depth === 0 && entry.isFile() && entry.name === FILE_DAY) yield file
    else if (depth > 0 && entry.isDirectory()) yield* dayFiles(file, depth - 1)
  }
}

export default class DayUnsummarizedTask extends Command {
  static override description: CommandDescription = {
    name: 'day:unsummarized',
    description: 'List previous notebook days without a saved summary',
    descriptionLong: [
      'Lists days with a day.md file but no summary.md, oldest first.',
      'Excludes the current notebook day and future days. Uses the calendar date when no day has been started.',
      'Does not generate summaries or change files.',
    ],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<Result>> {
    const { config, output } = context
    let currentDay: PlainDate
    try {
      currentDay = context.notebookNow.plainDateTime.plainDate
    } catch {
      currentDay = context.systemNow.plainDateTime.plainDate
    }
    const layout = layoutByPattern(config.NBFS_LAYOUT) ?? configured
    const depth = layout.dayFile(currentDay).split(path.sep).length - 1
    const missing = new Set<string>()
    for await (const file of dayFiles(config.DIR_TIME, depth)) {
      // Parse relative to a synthetic time root, even when DIR_TIME has a custom name.
      const relative = path.join('time', path.relative(config.DIR_TIME, file))
      if (layout.parseTimePath(relative)?.kind !== 'day') continue
      const date = layout.parseDateFromDayPath(relative)
      if (PlainDate.compare(date, currentDay) < 0 && !(await hasDaySummary(file))) missing.add(date.ymd)
    }
    const days = [...missing].sort()
    output.log(
      days.length ? colors.yellow('\n  Days without summaries:') : colors.green('\n  ✓ No days without summaries'),
    )
    output.log(colors.gray(`  Excluding current notebook day: ${currentDay.ymd}\n`))
    for (const ymd of days)
      output.log(`    ${colors.yellowBright(ymd)} ${colors.gray('—')} ${new PlainDate(ymd).dayShort}`)
    if (days.length)
      output.log(colors.gray(`\n  ${days.length} ${days.length === 1 ? 'day' : 'days'} awaiting summary`))
    return CommandResult.success({ days, currentDay: currentDay.ymd })
  }
}
