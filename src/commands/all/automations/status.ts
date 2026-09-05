import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_AUTOMATIONS, FILE_AUTOMATIONS_STATE } from '#config'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import AutomationStateStore, { type AutomationRun } from '#shared/models/Automation/state.ts'
import { describeTrigger, dueFiring, frameOf, resolveNow } from '#shared/models/Automation/trigger.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  verbose: Flag.bool('Show the brief and every unread frontmatter key', { short: 'v', default: false }),
}

type Params = InferParams<typeof params>

type StatusRow = {
  name: string
  run: string
  trigger: string
  frame: string
  state: 'active' | 'paused' | 'expired'
  lastRun?: AutomationRun
  due: boolean
  unknownKeys: string[]
  /** The charter body, verbatim — what this automation is for */
  brief: string
  /** The charter's path relative to the automations directory */
  file: string
  /** Recent runs, newest first, from the bounded ledger */
  runs: AutomationRun[]
}

type Result = {
  rows: StatusRow[]
  charterErrors: { path: string; error: string }[]
  stateError?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'automations:status': {
      params: Params
      result: Result
    }
  }
}

function describeLastRun(run: AutomationRun | undefined): string {
  if (!run) return colors.dim('never')
  const late = run.lateMinutes && run.lateMinutes > 0 ? colors.yellow(` +${run.lateMinutes}m`) : ''
  const paint = run.outcome === 'failed' ? colors.red : run.outcome === 'acted' ? colors.green : colors.dim
  return `${run.clock} ${paint(run.outcome)}${late}`
}

export default class AutomationsStatusTask extends Command {
  static override description: CommandDescription = {
    name: 'automations:status',
    description: 'Show declared automations: their trigger, last run and whether anything is due.',
    descriptionLong: [
      'Reads the charters in the notebook automations/ folder and the run-state',
      'kept outside it, then reports what each one is waiting for. Charters that',
      'cannot be read are listed with the reason, since a charter that never',
      'fires looks exactly like one that had nothing to do.',
    ],
    usage: ['sky automations:status', 'sky automations:status --verbose'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const { byName, errors } = await loadAutomationDir(DIR_AUTOMATIONS)
    const state = await AutomationStateStore.load(FILE_AUTOMATIONS_STATE)
    const systemNow = new ZonedDateTime()
    const today = systemNow.normalize().plainDateTime.plainDate

    const rows: StatusRow[] = []
    for (const [name, { automation, path: charterPath }] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
      const { trigger } = automation
      const runnable = automation.isRunnable(today)
      const now = resolveNow(trigger, systemNow)
      const row: StatusRow = {
        name,
        run: automation.run,
        trigger: describeTrigger(trigger),
        frame: frameOf(trigger),
        state: automation.status === 'paused' ? 'paused' : runnable ? 'active' : 'expired',
        due: runnable && dueFiring(trigger, { now, lastRun: state.lastRunFor(name, trigger) }) !== null,
        unknownKeys: automation.unknownKeys,
        brief: automation.brief,
        file: path.relative(DIR_AUTOMATIONS, charterPath),
        runs: state.runsFor(name),
      }
      const last = state.last(name)
      if (last) row.lastRun = last
      rows.push(row)
    }

    if (!rows.length && !errors.length) {
      output.log(`No automations declared. Charters live in ${DIR_AUTOMATIONS}`)
      return CommandResult.success({ rows, charterErrors: errors })
    }

    for (const row of rows) {
      const state_ = row.state === 'active' ? '' : colors.dim(` [${row.state}]`)
      const due = row.due ? colors.cyan(' DUE') : ''
      output.log(`${colors.bold(row.name)}${state_}${due}`)
      output.log(`  ${colors.dim('runs')}  ${row.run}`)
      output.log(`  ${colors.dim('when')}  ${row.trigger} ${colors.dim(`(${row.frame})`)}`)
      output.log(`  ${colors.dim('last')}  ${describeLastRun(row.lastRun)}`)
      if (row.lastRun?.message) output.log(`  ${colors.dim('note')}  ${row.lastRun.message}`)
      if (row.unknownKeys.length) {
        output.log(`  ${colors.yellow('keys')}  nothing reads: ${row.unknownKeys.join(', ')}`)
      }
      if (args.verbose) {
        const firstLine = row.brief.split('\n').find((line) => line.trim()) ?? colors.dim('(no brief)')
        output.log(`  ${colors.dim('brief')} ${firstLine}`)
      }
    }

    if (errors.length) {
      output.log('')
      output.log(colors.red(`${errors.length} charter(s) could not be read:`))
      for (const problem of errors) output.log(`  ${problem.path}: ${problem.error}`)
    }

    if (state.loadError) {
      output.log('')
      output.log(colors.red(`Run-state unusable, so every charter reads as never run: ${state.loadError}`))
    }

    const result: Result = { rows, charterErrors: errors }
    if (state.loadError) result.stateError = state.loadError
    return CommandResult.success(result)
  }
}
