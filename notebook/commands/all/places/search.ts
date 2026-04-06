import * as path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import colors from 'picocolors'
import openEditor from '#lib/shell/openEditor.ts'
import outputFile from '#shared/fs/outputFile.ts'
import { latinize } from '#lib/string/mod.ts'
import { Arg, Command, CommandArgs, CommandDescription, CommandResult, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import { PlaceDocument } from '#shared/models/Place/mod.ts'
import type { PlaceCreateInput } from '#shared/models/Place/mod.ts'
import {
  assembleGoogleAddressComponents,
  fetchGoogleMapsPlaceDetails,
  fetchGoogleMapsTextSearch,
  MAP_TYPE_DIR,
} from './_google.ts'

const boldGreen = (str: string) => colors.bold(colors.green(str))
const boldCyan = (str: string) => colors.bold(colors.cyan(str))

const params = {
  query: Arg.string('Place to query'),
  name: Flag.string('Name override', { short: 'n' }),
}

type Params = InferParams<typeof params>

export default class PlacesSearchTask extends Command {
  static override description: CommandDescription = {
    name: 'places:search',
    description: 'Search for a place and then add it.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, env, output } = context
    const { query, name } = args

    const googleSearchRes = await fetchGoogleMapsTextSearch(query, env.GOOGLE_MAPS_KEY)

    if (googleSearchRes.status !== 'OK') {
      output.log(JSON.stringify(googleSearchRes, null, 2))
      return CommandResult.error('Google Maps search failed')
    }
    if (!Array.isArray(googleSearchRes.results)) {
      output.log(JSON.stringify(googleSearchRes, null, 2))
      return CommandResult.error('Invalid Google Maps search results')
    }
    if (googleSearchRes.results.length === 0) {
      output.log(JSON.stringify(googleSearchRes, null, 2))
      return CommandResult.error('No search results found')
    }

    const firstGoogleSearchRes = googleSearchRes.results[0]
    const locationType: string = firstGoogleSearchRes?.types[0] || ''

    const placeType = Reflect.get(MAP_TYPE_DIR, locationType) as string | undefined
    if (!placeType) {
      output.log(`\n  Don't have mapping for "${locationType}".\n`)
      return CommandResult.error(`No mapping for location type: ${locationType}`)
    }

    output.log('\nIs this Google Maps Search correct?\n')
    output.log(boldGreen('NAME: ') + firstGoogleSearchRes.name)
    output.log(boldGreen('TYPE: ') + locationType + ' ' + boldCyan(`(${placeType})`))
    output.log(boldGreen('ADDRESS: ') + firstGoogleSearchRes.formatted_address)
    output.log(boldGreen('PLACE ID: ') + firstGoogleSearchRes.place_id)

    output.log('\nCorrect? (y/N): ')
    if (!(await isCorrectContinue())) {
      output.log('Aborting.')
      return CommandResult.success()
    }

    const nameOverride = name || latinize(firstGoogleSearchRes.name)

    const googlePlaceRes = await fetchGoogleMapsPlaceDetails(firstGoogleSearchRes.place_id, env.GOOGLE_MAPS_KEY)

    if (googlePlaceRes.status !== 'OK') {
      output.log(JSON.stringify(googlePlaceRes, null, 2))
      return CommandResult.error('Google Places details fetch failed')
    }
    if (!googlePlaceRes?.result?.address_components) {
      output.log(JSON.stringify(googlePlaceRes, null, 2))
      return CommandResult.error('Invalid Google Places details response')
    }

    const googlePlaceDetails = googlePlaceRes?.result || {}
    const googleAddressComponents = googlePlaceRes.result.address_components
    output.log(JSON.stringify(googleAddressComponents, null, 2))

    const addressData = assembleGoogleAddressComponents(googleAddressComponents)

    // Build PlaceDocument using the new model
    const placeInput: PlaceCreateInput = {
      name: nameOverride,
      type: placeType,
      address: firstGoogleSearchRes.formatted_address,
      site: googlePlaceDetails.website,
      location: {
        country: addressData.country,
        region: addressData.state || undefined,
        city: addressData.city || undefined,
        subcity: addressData.subcity || undefined,
        latitude: googlePlaceDetails?.geometry?.location?.lat ?? 0,
        longitude: googlePlaceDetails?.geometry?.location?.lng ?? 0,
        plusCode: googlePlaceDetails?.plus_code?.global_code,
      },
      googleMapsUrl: googlePlaceDetails.url,
    }

    const placeDoc = PlaceDocument.create(placeInput)
    const placeFile = path.join(config.DIR_PLACES_LOCATIONS, placeDoc.toFilePath() + '.md')

    await writeAndOpenPlace(placeFile, placeDoc)

    output.log(`\nSuccessfully created ${placeFile}.\n`)
    output.log(`Location: ${placeDoc.toLocationDisplayString()}`)

    return CommandResult.success()
  }
}

async function isCorrectContinue(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    rl.close()
    return line === 'y'
  }
  return false
}

async function writeAndOpenPlace(file: string, doc: PlaceDocument): Promise<void> {
  const markdown = doc.toMarkdown()
  await outputFile(file, markdown)
  openEditor([{ file, line: markdown.split('\n').length }])
}
