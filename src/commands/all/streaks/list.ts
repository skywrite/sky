import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { loadAllStreaks, loadStreakEntries, loadStreaks } from '#lib/streaks/mod.ts'
import { computeStreakStats, type StreakStats } from '#shared/models/Streak/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

const params = {
  all: Flag.boolean('Include archived streaks', { short: 'a', default: false }),
}

type Params = InferParams<typeof params>
type Result = { streaks: Array<StreakStats & { status: string; endsYmd: string | null }> }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:list': {
      params: Params
      result: Result
    }
  }
}

async function notebookToday(): Promise<PlainDate> {
  try {
    const now = await fetchNow()
    return now.plainDateTime.plainDate
  } catch {
    return new PlainDate()
  }
}

export default class StreaksListTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:list',
    description: 'Show streak status: current run, best run, month consistency.',
    usage: ['sky streaks:list        # Active streaks', 'sky streaks:list --all  # Include archived'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const loaded = args.all ? await loadAllStreaks() : await loadStreaks('active')

    if (loaded.length === 0) {
      output.log('No streaks yet. Create one with `sky streaks:new`.')
      return CommandResult.success({ streaks: [] })
    }

    const today = await notebookToday()

    const starts = loaded.map(({ streak }) => streak.start).filter((s): s is PlainDate => s !== undefined)
    const earliest = starts.length > 0 ? starts.reduce((a, b) => (PlainDate.compare(a, b) <= 0 ? a : b)) : today
    const entries = await loadStreakEntries(earliest, today)

    const rows = loaded.map(({ streak, status }) => ({
      ...computeStreakStats(streak, entries, today),
      status,
      endsYmd: status === 'active' ? (streak.end?.ymd ?? null) : null,
    }))

    const titleWidth = Math.max(...rows.map((r) => r.title.length))
    const nameWidth = Math.max(...rows.map((r) => r.name.length))

    output.log('')
    for (const row of rows) {
      const mark =
        row.status === 'archived'
          ? colors.dim('■')
          : row.completedToday
            ? colors.green('✓')
            : row.trackedToday
              ? colors.yellow('·')
              : colors.dim('—')

      const month = row.monthTracked > 0 ? `${row.monthDone}/${row.monthTracked}` : '—'

      output.log(
        [
          `  ${mark} ${row.title.padEnd(titleWidth)}`,
          colors.dim(row.name.padEnd(nameWidth)),
          `${String(row.current).padStart(3)}d`,
          colors.dim(`best ${row.best}d`),
          colors.dim(`month ${month}`),
          ...(row.endsYmd ? [colors.dim(`ends ${row.endsYmd}`)] : []),
        ].join('  '),
      )
    }
    output.log('')

    return CommandResult.success({ streaks: rows })
  }
}
