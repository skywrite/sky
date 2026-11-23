import * as path from 'node:path'
import { getManifest, type CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { commandOutcome } from '#lib/automations/commandOutcome.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type BackfillResult,
  DEFAULT_BACKFILL_DAYS,
  discoverDayRecaps,
  formatBackfillSummary,
  parseAppFilter,
  type RecapCommandSpec,
  type RecapRunOutcome,
  runRecapBackfill,
} from './lib/backfill.ts'
import { findRecapFile } from './lib/writeRecapFile.ts'

const params = {
  days: Flag.number('Past days to check for missing recaps (1-30)', {
    short: 'd',
    default: DEFAULT_BACKFILL_DAYS,
  }),
  apps: Flag.string('Comma-separated recap apps to include (default: all installed)', {
    optional: true,
  }),
  dryRun: Flag.bool('List missing recaps without running them', { default: false }),
  force: Flag.bool('Re-check days previously recorded as having nothing to recap', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'recap:backfill': { params: Params; result: BackfillResult }
  }
}

export interface BackfillCommandDeps {
  loadManifest?: () => Promise<CommandsManifest>
  today?: () => PlainDate
  runRecap?: (spec: RecapCommandSpec, day: PlainDate, context: CommandContext) => Promise<RecapRunOutcome>
}

export default class RecapBackfillTask extends Command {
  static override description: CommandDescription = {
    name: 'recap:backfill',
    description: 'Backfill missing day recaps across installed recap commands',
    descriptionLong: [
      'Scans recent finished days and runs any installed day recap command',
      '(recap:<app>) whose recap file is missing.',
      '',
      'Only days strictly before the newest started day are eligible, so an',
      'in-progress day is never recapped early while missed days across travel',
      'gaps still catch up once a later day starts.',
      '',
      'Days where a recap succeeds with nothing to write are remembered in',
      'state/recap/backfill.json so repeated runs stay quiet; failed runs are',
      'never cached and retry automatically on the next pass.',
    ],
    usage: [
      'sky recap:backfill                     # Check the last 5 days across all recap apps',
      'sky recap:backfill --days 10           # Check the last 10 days',
      'sky recap:backfill --apps github,slack # Limit to specific recap apps',
      'sky recap:backfill --dry-run           # Preview missing recaps without running them',
      'sky recap:backfill --force             # Re-check previously empty days',
    ],
    params,
  }

  private readonly deps: BackfillCommandDeps

  constructor(deps: BackfillCommandDeps = {}) {
    super()
    this.deps = deps
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<BackfillResult>> {
    const { config, output } = context
    const timeDir = <string>config.DIR_TIME
    const stateDir = path.join(<string>config.DIR_STATE, 'recap')

    const manifest = await (this.deps.loadManifest ?? getManifest)()
    const recaps = discoverDayRecaps(manifest)
    const today = (this.deps.today ?? (() => PlainDate.today()))()
    const apps = parseAppFilter(args.apps)

    const runRecap =
      this.deps.runRecap ??
      (async (spec: RecapCommandSpec, day: PlainDate, ctx: CommandContext): Promise<RecapRunOutcome> => {
        // Use a fresh scope so backfill flags (days, apps, force, dryRun) do not leak into child recaps.
        const childTasks = new CommandService(ctx, {}, { _: [] }, 'recap:backfill')
        const result = await childTasks.run(spec.command, {
          day,
          ...(spec.supportsNoEditor ? { noEditor: true } : {}),
        })
        const mapped = commandOutcome(result)
        return {
          ok: mapped.outcome !== 'failed',
          message: mapped.message ?? result.error?.message,
        }
      })

    let result: BackfillResult
    try {
      result = await runRecapBackfill({
        recaps,
        today,
        days: args.days,
        apps,
        dryRun: args.dryRun,
        force: args.force,
        stateDir,
        started: (day) => hasStarted(day, timeDir),
        hasRecap: async (day, app) => (await findRecapFile(day, app, timeDir)) !== null,
        runRecap: (spec, day) => runRecap(spec, day, context),
        signal: context.signal,
        log: (line) => output.log(line),
      })
    } catch (err) {
      return CommandResult.fail(err instanceof Error ? err.message : String(err))
    }

    const summary = formatBackfillSummary(result)
    output.log(summary)

    if (result.stopped || result.errors.length > 0) {
      return CommandResult.fail(summary, result)
    }
    return CommandResult.success(result, summary)
  }
}

async function hasStarted(day: PlainDate, timeDir: string): Promise<boolean> {
  try {
    return (await readDay(day, timeDir)).started !== undefined
  } catch {
    return false
  }
}
