import { Command, CommandResult, dayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { ensureDay, withDayWrite } from '#lib/nbfs/mod.ts'
import { computeStreakCounts, loadStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

async function updateStartField(targetDay: PlainDate, tz: string | undefined, timeDir: string): Promise<void> {
  let dayModel = await readDay(targetDay, timeDir)

  if (tz) {
    dayModel = dayModel.setStarted(ZonedDateTime.now().inTimeZone(tz)).setTimezone(tz).updateYaml({ ended: null })
  } else {
    dayModel = dayModel.setStarted().updateYaml({ ended: null })
  }

  await writeDay(dayModel, timeDir)
}

/**
 * Stamp active streaks when the day starts, including on a day prepared by a task move.
 */
async function reconcileStreaks(targetDay: PlainDate, timeDir: string, streaksDir: string) {
  const active = (await loadStreaks('active', streaksDir)).map((loaded) => loaded.streak)
  if (active.length === 0) return

  const counts = await computeStreakCounts(active, targetDay)
  const dayModel = await readDay(targetDay, timeDir)
  const stamped = stampStreaksList(dayModel, active, targetDay, counts)
  if (stamped !== dayModel) await writeDay(stamped, timeDir)
}

const params = {
  day: dayArg(),
  journal: Flag.bool('Create journal files for the day', { short: 'j', default: false }),
  tz: Flag.string('IANA timezone (e.g., America/New_York)', { optional: true }),
  skipLocation: Flag.bool('Skip setting location on the day', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:start': { params: Params; result: undefined }
  }
}

export default class DayStartTask extends Command {
  static override description: CommandDescription = {
    name: 'day:start',
    description: 'Run tasks for start of the day.',
    params,
  }

  async run(commandArgs: CommandArgs<Params>): Promise<CommandResult> {
    const { tasks, args, context } = commandArgs
    const { config } = context
    const { journal, tz, day, skipLocation } = args

    // Wake the heartbeat in case it's sleeping (best-effort)
    fetch(`http://localhost:${config.PORT_SERVER}/heartbeat/wake`, { method: 'POST' }).catch(() => {})

    const targetDate = day ?? (tz ? new PlainDate(ZonedDateTime.now().inTimeZone(tz).date) : new PlainDate())

    // Yesterday's meetings, checked before today starts: amending is cheapest now
    await tasks.run('day:meeting:check', { day: targetDate.addDays(-1) })

    await ensureDay(targetDate, config.DIR_TIME)

    // Run configurable startup commands in parallel (day.start in config)
    const startResults = await Promise.allSettled(
      config.DAY_START_COMMANDS.map((cmd) =>
        tasks.run(cmd, { day: targetDate }).catch((err: Error) => {
          // Command may not exist (e.g., moved to sky-extras without commandDirs configured)
          console.warn(`  [day:start] ${cmd}: ${err.message}`)
          return CommandResult.fail(err.message)
        }),
      ),
    )

    for (const result of startResults) {
      if (result.status === 'rejected') {
        return CommandResult.error(result.reason as Error, 'Task failed')
      }
    }

    // These tasks modify the Day file, so run them sequentially
    await withDayWrite(config, targetDate.ymd, async () => {
      await updateStartField(targetDate, tz, config.DIR_TIME)

      // Streaks are best-effort: a missing streaks/ dir must not fail the start
      try {
        await reconcileStreaks(targetDate, config.DIR_TIME, config.DIR_STREAKS)
      } catch (err) {
        console.warn(`  [day:start] streaks: ${(err as Error).message}`)
      }
    })

    // Set location on day document
    if (tasks && !skipLocation) {
      await tasks.run('day:location', { day }).catch(() => {})
    }

    // Set timezone if --tz was not provided
    if (!tz) {
      await tasks.run('day:timezone').catch(() => {})
    }

    // Create journal files if requested
    if (journal && tasks) {
      const journalResult = await tasks.run('journal:new', { all: true })
      if (!journalResult.ok) return journalResult
    }

    return CommandResult.success()
  }
}
