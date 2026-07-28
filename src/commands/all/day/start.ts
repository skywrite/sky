import { PORT_SERVER, DAY_START_COMMANDS } from '#config'
import { Command, CommandResult, dayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { computeStreakCounts, loadStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

interface UpdateStartOptions {
  tz?: string
  day?: PlainDate
}

async function updateStartField(opts: UpdateStartOptions = {}): Promise<PlainDate> {
  const { tz, day } = opts

  let targetDay: PlainDate
  let startedZdt: ZonedDateTime | undefined

  if (tz) {
    // Convert current system time to the specified timezone
    const nowInTargetTz = ZonedDateTime.now().inTimeZone(tz)
    startedZdt = nowInTargetTz

    // Use explicitly specified date, or derive from the converted time
    targetDay = day ?? new PlainDate(nowInTargetTz.date)
  } else {
    // No timezone specified, use system date
    targetDay = day ?? new PlainDate()
  }

  let dayModel = await readDay(targetDay)

  if (tz && startedZdt) {
    dayModel = dayModel.setStarted(startedZdt).setTimezone(tz).updateYaml({ ended: null })
  } else {
    dayModel = dayModel.setStarted().updateYaml({ ended: null })
  }

  await writeDay(dayModel)

  return targetDay
}

/**
 * Reconcile the day's Streaks list with the active rules: add streaks created
 * since the week was stamped and refresh count decorations on unstruck items.
 */
async function reconcileStreaks(targetDay: PlainDate) {
  const active = (await loadStreaks('active')).map((loaded) => loaded.streak)
  if (active.length === 0) return

  const counts = await computeStreakCounts(active, targetDay)
  const dayModel = await readDay(targetDay)
  const stamped = stampStreaksList(dayModel, active, targetDay, counts)
  if (stamped !== dayModel) await writeDay(stamped)
}

const params = {
  day: dayArg(),
  journal: Flag.boolean('Create journal files for the day', { short: 'j', default: false }),
  tz: Flag.string('IANA timezone (e.g., America/New_York)', { optional: true }),
  skipLocation: Flag.boolean('Skip setting location on the day', { default: false }),
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
    const { tasks, args } = commandArgs
    const { journal, tz, day, skipLocation } = args

    // Wake the heartbeat in case it's sleeping (best-effort)
    fetch(`http://localhost:${PORT_SERVER}/heartbeat/wake`, { method: 'POST' }).catch(() => {})

    // Run configurable startup commands in parallel (day.start in config)
    const startResults = await Promise.allSettled(
      DAY_START_COMMANDS.map((cmd) =>
        tasks.run(cmd).catch((err: Error) => {
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
    const targetDay = await updateStartField({ tz, day })

    // Streaks are best-effort: a missing streaks/ dir or day file must not fail the start
    try {
      await reconcileStreaks(targetDay)
    } catch (err) {
      console.warn(`  [day:start] streaks: ${(err as Error).message}`)
    }

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
