import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { CommandResultType } from '#commands/lib/core/CommandTypesRegistry.ts'
import type * as ConfigModule from '#shared/config.ts'
import type ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import type { ClockReading, ClockRoutesOptions, ClockSnapshot, ConvertAnswer } from './mod.ts'

/**
 * The clock page over the real notebook: each request reads the clocks
 * the way a command would — notebook now from the last started day in
 * that day's `tz:`, system now from the machine — and a conversion is
 * one in-process util:tz:convert run, model call included.
 */

function readingOf(zdt: ZonedDateTime): ClockReading {
  return { date: zdt.date, time: zdt.time, timezone: zdt.timezone }
}

/** Keep the requested place while translating command results to calendar clock readings. */
export function convertAnswerOf(data: CommandResultType<'util:tz:convert'>): ConvertAnswer {
  // The command keeps extended hours across day boundaries — right for
  // notebook filing, wrong for a world clock: 28:46 today is 04:46 tomorrow.
  return {
    local: readingOf(data.local.normalize()),
    target: { ...readingOf(data.target.normalize()), place: data.targetName },
    utc: readingOf(data.utc.normalize()),
  }
}

export function createClockHost(config: typeof ConfigModule, env: Record<string, string>): ClockRoutesOptions {
  return {
    now: (): ClockSnapshot => {
      const context = CommandContext.server(config, env)
      return { notebook: readingOf(context.notebookNow), system: readingOf(context.systemNow) }
    },

    convert: async (query: string) => {
      const context = CommandContext.server(config, env)
      const tasks = new CommandService(context)
      const result = await tasks.run('util:tz:convert', { query, json: true })
      const data = result.data
      if (result.status !== 'success' || !data) {
        throw new Error(result.message ?? 'util:tz:convert failed')
      }
      return convertAnswerOf(data)
    },
  }
}
