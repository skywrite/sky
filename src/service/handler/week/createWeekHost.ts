import CommandContext from '#commands/lib/core/CommandContext.ts'
import type { CommandResult } from '#commands/lib/core/CommandResult.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as ConfigModule from '#shared/config.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { WeekCommands } from './mod.ts'

/**
 * The week and day pages over the real notebook: each button is one
 * in-process command run, exactly the run the terminal would do —
 * day:start with its meeting check, streaks, location and time zone.
 */
export function createWeekHost(config: typeof ConfigModule, env: Record<string, string>): WeekCommands {
  const createTasks = () => new CommandService(CommandContext.server(config, env))
  const requireSuccess = (name: string, result: CommandResult<unknown>): void => {
    if (result.status !== 'success') throw new Error(result.message ?? `${name} did not finish`)
  }
  return {
    async startDay(day: PlainDate): Promise<void> {
      requireSuccess('day:start', await createTasks().run('day:start', { day }))
    },
  }
}
