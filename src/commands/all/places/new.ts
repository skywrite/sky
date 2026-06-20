import * as path from 'node:path'
import { exists, outputFile } from '#shared/fs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { PlaceDocument, PLACE_TYPES } from '#shared/models/Place/mod.ts'
import type { PlaceCreateInput } from '#shared/models/Place/mod.ts'
import { assembleGoogleAddressComponents } from './_google.ts'
import { fetchGoogleGeocode } from '../util/location/fetchGoogleGeocode.ts'
import { resolveMapsUrlToCoords } from './_maps.ts'

const params = {
  name: ArgOrFlag.string('Place name (e.g. "Beach house")', { short: 'n', required: true }),
  maps: Flag.string('Google Maps link to resolve coordinates from', { short: 'm' }),
  lat: Flag.string('Latitude (overrides --maps resolution)'),
  long: Flag.string('Longitude (overrides --maps resolution)'),
  type: Flag.string('Place type (residence, eat, drink, visit, ...)', { short: 't', default: () => 'residence' }),
  address: Flag.string('Address override (defaults to the geocoded address)', { short: 'a' }),
  site: Flag.string('Website URL'),
}

type Params = InferParams<typeof params>
type Result = { filePath: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'places:new': { params: Params; result: Result }
  }
}

export default class PlacesNewTask extends Command {
  static override description: CommandDescription = {
    name: 'places:new',
    description: 'Create a place manually from a Maps link or coordinates.',
    descriptionLong: [
      'Creates a place file without a Google Maps text search — useful for homes',
      'and spots that are not searchable points of interest.',
      'Resolves coordinates from a Google Maps share link (or explicit --lat/--long),',
      'reverse-geocodes them into country/region/city, and files the place in the',
      'locations hierarchy. Defaults to type "residence".',
    ],
    usage: [
      'sky places:new "Beach house" -m <google-maps-link>',
      'sky places:new "Cliff viewpoint" --lat 36.0544 --long -112.1401',
      'sky places:new "Joe\'s Cafe" -m <link> --type drink',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, env, output } = context
    const { name, maps, lat, long, type, address, site } = args

    if (!name) {
      return CommandResult.fail('Name is required')
    }
    if (!PLACE_TYPES.has(type)) {
      return CommandResult.fail(`Invalid type "${type}". Valid types: ${[...PLACE_TYPES].sort().join(', ')}`)
    }
    if (!env.GOOGLE_MAPS_KEY) {
      return CommandResult.error('GOOGLE_MAPS_KEY is not set')
    }
    if ((lat && !long) || (long && !lat)) {
      return CommandResult.fail('Both --lat and --long are required when set manually')
    }

    // 1. Resolve coordinates: explicit --lat/--long win, otherwise the maps link.
    let latitude: number
    let longitude: number
    if (lat && long) {
      latitude = Number.parseFloat(lat)
      longitude = Number.parseFloat(long)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return CommandResult.fail(`Invalid coordinates: ${lat}, ${long}`)
      }
    } else if (maps) {
      const coords = await resolveMapsUrlToCoords(maps)
      if (!coords) {
        return CommandResult.fail(`Could not resolve coordinates from: ${maps}\nPass --lat and --long instead.`)
      }
      latitude = coords.latitude
      longitude = coords.longitude
    } else {
      return CommandResult.fail('Provide a Maps link with --maps/-m, or --lat and --long')
    }

    // 2. Reverse-geocode the coordinates into address components.
    const geo = await fetchGoogleGeocode(latitude, longitude, env.GOOGLE_MAPS_KEY)
    if (geo.status !== 'OK' || !Array.isArray(geo.results) || geo.results.length === 0) {
      output.log(JSON.stringify(geo, null, 2))
      return CommandResult.error(`Reverse geocoding failed (status: ${geo.status})`)
    }
    const top = geo.results[0]
    const addressData = assembleGoogleAddressComponents(top.address_components)

    if (!addressData.country) {
      return CommandResult.fail('Could not determine country from the coordinates')
    }

    // 3. Build the place document (mirrors places:search).
    const placeInput: PlaceCreateInput = {
      name,
      type,
      address: address || top.formatted_address,
      site: site || undefined,
      location: {
        country: addressData.country,
        region: addressData.state || undefined,
        city: addressData.city || undefined,
        subcity: addressData.subcity || undefined,
        latitude,
        longitude,
        plusCode: top.plus_code?.global_code ?? geo.plus_code?.global_code,
      },
      googleMapsUrl: maps || undefined,
    }

    const placeDoc = PlaceDocument.create(placeInput)

    // 4. Resolve the file path, avoiding collisions (never clobber existing notes).
    let placeFile = path.join(config.DIR_PLACES_LOCATIONS, placeDoc.toFilePath() + '.md')
    const baseFile = placeFile
    let counter = 2
    while (await exists(placeFile)) {
      const baseName = path.basename(baseFile, '.md')
      const dir = path.dirname(baseFile)
      placeFile = path.join(dir, `${baseName}-${counter}.md`)
      counter++
    }

    // 5. Write and open.
    const markdown = placeDoc.toMarkdown()
    await outputFile(placeFile, markdown)
    openEditor([{ file: placeFile, line: markdown.split('\n').length }])

    output.log(`\nSuccessfully created ${placeFile}.`)
    output.log(`Location: ${placeDoc.toLocationDisplayString()}`)

    return CommandResult.success({ filePath: placeFile, name })
  }
}
