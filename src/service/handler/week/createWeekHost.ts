import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as ConfigModule from '#shared/config.ts'
import { type PlainDate, PlainDateTime, type Week } from '#universal/dates/nbdt/mod.ts'
import type { WeekCommands } from './mod.ts'

/**
 * The week page over the real notebook: each button is one in-process
 * command run, exactly the run the terminal would do — day:start with its
 * meeting check, streaks, location and time zone; day:end with its sweep;
 * week:new for the week's files.
 */
export function createWeekHost(config: typeof ConfigModule, env: Record<string, string>): WeekCommands {
  const run = async (name: string, args: Record<string, unknown>) => {
    const tasks = new CommandService(CommandContext.server(config, env))
    const result = await tasks.run(name, args)
    if (result.status !== 'success') throw new Error(result.message ?? `${name} did not finish`)
  }
  return {
    startDay: (day: PlainDate) => run('day:start', { day }),
    endDay: (day: PlainDate) => run('day:end', { day }),
    createWeek: (week: Week) => run('week:new', { when: new PlainDateTime(week.startInYear) }),
  }
}
