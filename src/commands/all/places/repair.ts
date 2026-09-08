import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { countryPlace, ensurePlaceRecord } from '#lib/places/geography.ts'
import { planPlaceRepair, type PlaceRepairPlan } from '#lib/places/repair.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'

const params = {
  apply: Flag.bool('Create the missing recognized country records (preview by default)', { default: false }),
}
type Params = InferParams<typeof params>
type Result = PlaceRepairPlan & { created: number; dryRun: boolean }
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'places:repair': { params: Params; result: Result }
  }
}

export default class PlacesRepair extends Command {
  static override description: CommandDescription = {
    name: 'places:repair',
    description: 'Find unresolved place references and create missing country records.',
    descriptionLong: [
      'Preview by default; --apply creates recognized countries as markdown records.',
      'References needing a confirmed name or geographic kind are reported for places:ensure. Existing notes and references are preserved.',
    ],
    usage: ['sky places:repair', 'sky places:repair --apply'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const store = await MarkdownStore.build({
      peopleDirs: [config.DIR_PEOPLE, config.DIR_PEOPLE_OLD],
      orgDirs: [config.DIR_ORGS],
      projectsDir: config.DIR_PROJECTS,
      decisionsDir: config.DIR_DECISIONS,
      goalsDir: config.DIR_GOALS,
      streaksDir: config.DIR_STREAKS,
      trackingDir: config.DIR_TRACKING,
      ideasDir: config.DIR_IDEAS,
      placesDir: config.DIR_PLACES,
      timeDirs: [config.DIR_TIME],
      libraryDir: config.DIR_LIBRARY,
      aiDir: config.DIR_AI,
    })
    const plan = planPlaceRepair(
      DomainCollection.fromStore(store).allItems.map((item) => item.doc),
      store.places,
    )
    let created = 0
    for (const item of plan.create) {
      if (args.apply) {
        const result = await ensurePlaceRecord(store.places, config.DIR_PLACES, countryPlace(item.ref)!)
        if (result.created) created++
      }
      output.log(`${args.apply ? 'Available' : 'Would create'}: ${item.name} (${item.ref})`)
    }
    for (const item of plan.unresolved) output.log(`Unresolved: ${item.ref} (${item.uses} documents) — ${item.reason}`)
    output.log(
      `${plan.create.length} country records, ${plan.unresolved.length} references need review.${args.apply ? '' : ' Pass --apply to create the country records.'}`,
    )
    return CommandResult.success({ ...plan, created, dryRun: !args.apply })
  }
}
