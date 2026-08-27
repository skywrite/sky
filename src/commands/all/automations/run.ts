import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_AUTOMATIONS, FILE_AUTOMATIONS_STATE } from '#config'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import AutomationStateStore, { type RunOutcome } from '#shared/models/Automation/state.ts'
import { dueFiring, resolveNow } from '#shared/models/Automation/trigger.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  name: Arg.string('Charter to run, by file name (without .md)'),
  stamp: Flag.bool('Record the run in state, as a scheduled pass would', { default: false }),
}

type Params = InferParams<typeof params>

type Result = {
  name: string
  run: string
  outcome: RunOutcome
  target: string
  lateMinutes: number
  stamped: boolean
  message?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'automations:run': {
      params: Params
      result: Result
    }
  }
}

export default class AutomationsRunTask extends Command {
  static override description: CommandDescription = {
    name: 'automations:run',
    description: 'Run one declared automation now, whether or not it is due.',
    descriptionLong: [
      'Runs the command a charter names, with the charter args, and reports what',
      'it did. By default the run is not recorded, so forcing one by hand does',
      'not move the schedule; pass --stamp to record it the way a scheduled pass',
      'would. Paused and expired charters still run when asked directly — the',
      'point of asking is to override.',
    ],
    usage: ['sky automations:run market-open', 'sky automations:run email-fetch --stamp'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { name, stamp } = args

    const { byName, errors } = await loadAutomationDir(DIR_AUTOMATIONS)

    const found = byName.get(name)
    if (!found) {
      const broken = errors.find((problem) => problem.path.includes(`${name}.md`))
      if (broken) return CommandResult.fail(`Charter "${name}" could not be read: ${broken.error}`)
      const known = [...byName.keys()].sort().join(', ')
      return CommandResult.fail(known ? `No charter named "${name}". Declared: ${known}` : `No charter named "${name}"`)
    }

    const { automation } = found
    const { trigger } = automation
    const systemNow = new ZonedDateTime()
    const now = resolveNow(trigger, systemNow)

    // What the scheduled pass would have called this run, so a forced run and a
    // scheduled one hand the command the same context.
    const state = await AutomationStateStore.load(FILE_AUTOMATIONS_STATE)
    const firing = dueFiring(trigger, { now, lastRun: state.lastRunFor(name, trigger) })
    const [nowHours, nowMinutes] = now.time.split(':').map(Number)
    const target = firing?.target ?? (trigger.kind === 'every' ? `every ${trigger.raw}` : trigger.times[0].raw)
    const lateMinutes = firing ? Math.max(0, nowHours * 60 + nowMinutes - firing.fireMinutes) : 0

    if (automation.status === 'paused')
      output.log(colors.dim(`${name} is paused — running it anyway because you asked`))

    output.log(`Running ${colors.bold(automation.run)}${firing ? '' : colors.dim(' (not currently due)')}`)

    let outcome: RunOutcome = 'acted'
    let message: string | undefined
    try {
      const result = await tasks.run(automation.run, automation.args)
      if (result.status !== 'success') {
        outcome = 'failed'
        message = result.message
      }
    } catch (err) {
      outcome = 'failed'
      message = err instanceof Error ? err.message : String(err)
    }

    if (stamp) {
      state.record(name, {
        utc: systemNow.toUTC().normalize().plainDateTime,
        clock: now,
        outcome,
        target,
        lateMinutes,
        ...(message === undefined ? {} : { message }),
      })
      await state.save()
    }

    const painted = outcome === 'failed' ? colors.red(outcome) : colors.green(outcome)
    output.log(`${name} → ${painted}${message ? `: ${message}` : ''}`)
    if (!stamp) output.log(colors.dim('Not recorded — pass --stamp to move the schedule.'))

    const result: Result = { name, run: automation.run, outcome, target, lateMinutes, stamped: stamp }
    if (message !== undefined) result.message = message

    return outcome === 'failed'
      ? CommandResult.fail(message ?? 'automation failed', result)
      : CommandResult.success(result)
  }
}
