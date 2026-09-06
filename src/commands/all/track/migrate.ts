import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { executeTrackingMigration, planTrackingMigration, type TrackingRepair } from './lib/migrate.ts'

const params = {
  execute: Flag.bool('Migrate after backing up the original files (dry-run by default)', { default: false }),
  repairs: Flag.string('JSON file of explicit CSV line repairs, applied only when the original line matches', {
    optional: true,
  }),
}
type Params = InferParams<typeof params>

export default class TrackMigrateTask extends Command {
  static override description: CommandDescription = {
    name: 'track:migrate',
    description: 'Migrate weekly tracking CSVs to annual date-keyed files.',
    descriptionLong: [
      'Converts all weekly tracking categories to data/tracking/<year>/<slug>.csv.',
      'Aligns historical columns by name, preserves repeated entries, and merges existing annual records.',
      'Updates definitions to yearly storage. Original files are backed up under',
      'data/.tracking-migration-backups before verified weekly CSVs are removed.',
      'Non-CSV files stay in place. Dry-run by default; --execute applies the plan.',
    ],
    usage: ['sky track:migrate', 'sky track:migrate --execute'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const repairs: TrackingRepair[] = args.repairs ? JSON.parse(await readTextFile(args.repairs)) : []
    const plan = await planTrackingMigration(context.config.DIR_BASE as string, repairs)
    const { output } = context
    output.log(`${plan.weeklyFiles} weekly CSVs → ${plan.yearlyFiles} annual CSVs; ${plan.definitions} definitions`)
    output.log(`${plan.sourceRows} source rows: ${plan.addedRows} to add, ${plan.matchedRows} already present`)
    for (const warning of plan.warnings) output.log(`Warning: ${warning}`)
    for (const file of plan.leftovers) output.log(`Kept non-CSV file: ${file}`)
    if (!args.execute) {
      output.log('Dry run. Use --execute to back up and migrate.')
      return CommandResult.success()
    }
    const backup = await executeTrackingMigration(plan)
    output.log(backup ? `Migration complete. Original files: ${backup}` : 'Already migrated.')
    return CommandResult.success()
  }
}
