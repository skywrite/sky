import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { countryPlace, ensurePlaceRecord, type EnsuredPlace } from '#lib/places/geography.ts'
import PlaceDocument, { GEOGRAPHIC_KINDS, normalizePlaceRef, type GeographicKind } from '#shared/models/Place/mod.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'

const params = {
  ref: Arg.string('Canonical places/ reference', { required: true }),
  name: Flag.string('Display name (recognized countries are named automatically)'),
  kind: Flag.string('Geographic kind: country, region, city, neighborhood, area'),
  parent: Flag.string('Reference to the containing place'),
}
type Params = InferParams<typeof params>
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'places:ensure': { params: Params; result: EnsuredPlace }
  }
}

export default class PlacesEnsure extends Command {
  static override description: CommandDescription = {
    name: 'places:ensure',
    description: 'Create a geographic place without coordinates, or return its existing record.',
    descriptionLong: [
      'Countries can be created from their code. Other geographic places need a name and kind.',
      'Existing records and notes are preserved. A recognized country parent is created when needed.',
    ],
    usage: [
      'sky places:ensure places/FR',
      'sky places:ensure places/FR/Harbor-City --name "Harbor City" --kind city --parent places/FR',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<EnsuredPlace>> {
    const ref = normalizePlaceRef(args.ref)
    if (!ref) return CommandResult.fail('Provide a valid places/ reference.')
    const store = await PlaceStore.build(context.config.DIR_PLACES)
    const existing = store.findByPlacePath(ref)
    if (existing) {
      const result = { ref: existing.placePath, filePath: existing.path, name: existing.value.name, created: false }
      context.output.log(`Already exists: ${result.ref} → ${result.filePath}`)
      return CommandResult.success(result)
    }
    const country = countryPlace(ref)
    const kind = args.kind ?? country?.kind
    if (!kind || !GEOGRAPHIC_KINDS.includes(kind as GeographicKind))
      return CommandResult.fail('Provide --kind country, region, city, neighborhood, or area.')
    const name = args.name ?? country?.name
    if (!name) return CommandResult.fail('Provide --name for this place.')
    const doc = PlaceDocument.createGeographic({
      name,
      ref,
      kind: kind as GeographicKind,
      parent: args.parent,
      location: country?.location,
    })
    if (doc.parent && !store.findByPlacePath(doc.parent)) {
      const parent = countryPlace(doc.parent)
      if (!parent) return CommandResult.fail('Create the parent place first with places:ensure.')
      await ensurePlaceRecord(store, context.config.DIR_PLACES, parent)
    }
    const result = await ensurePlaceRecord(store, context.config.DIR_PLACES, doc)
    context.output.log(`${result.created ? 'Created' : 'Already exists'}: ${result.ref} → ${result.filePath}`)
    return CommandResult.success(result)
  }
}
