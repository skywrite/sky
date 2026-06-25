import * as path from 'node:path'
import colors from 'picocolors'
import * as p from '@clack/prompts'
import { SelectPrompt } from '@clack/core'
import openEditor from '#lib/shell/openEditor.ts'
import outputFile from '#shared/fs/outputFile.ts'
import { latinize } from '#lib/string/mod.ts'
import { Arg, Command, CommandArgs, CommandDescription, CommandResult, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import { PlaceDocument, PLACE_TYPES } from '#shared/models/Place/mod.ts'
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

    output.log('\nGoogle Maps search result:\n')
    output.log(boldGreen('NAME: ') + firstGoogleSearchRes.name)
    output.log(boldGreen('TYPE: ') + locationType + ' ' + boldCyan(`(${placeType})`))
    output.log(boldGreen('ADDRESS: ') + firstGoogleSearchRes.formatted_address)
    output.log(boldGreen('PLACE ID: ') + firstGoogleSearchRes.place_id)
    output.log('')

    const placeCorrect = await p.confirm({ message: 'Is this the correct place?' })
    if (p.isCancel(placeCorrect) || !placeCorrect) {
      output.log('Aborting.')
      return CommandResult.success()
    }

    // Confirm the auto-detected type; if it's wrong, let the user pick the right one.
    let resolvedType = placeType
    const typeCorrect = await p.confirm({ message: `Is the type "${placeType}" correct?` })
    if (p.isCancel(typeCorrect)) {
      output.log('Aborting.')
      return CommandResult.success()
    }
    if (!typeCorrect) {
      const selectedType = await pickType(
        'Select the correct type (↑/↓ or type a letter):',
        assignTypeKeys([...PLACE_TYPES].sort()),
        placeType,
      )
      if (p.isCancel(selectedType)) {
        output.log('Aborting.')
        return CommandResult.success()
      }
      resolvedType = selectedType
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
      type: resolvedType,
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

/**
 * Assign a unique single-character hotkey to each place type so the picker can be
 * driven by one keypress (e.g. "e" → eat). Types whose first letter no other type
 * shares keep it; the colliding ones (do/drink, shop/stadium/stay) fall back to the
 * next free letter in their own name. The chosen key is underlined in the picker.
 */
function assignTypeKeys(types: string[]): Array<{ type: string; key: string }> {
  const used = new Set<string>()
  const keyByType = new Map<string, string>()

  const firstLetterCounts = new Map<string, number>()
  for (const type of types) {
    firstLetterCounts.set(type[0], (firstLetterCounts.get(type[0]) ?? 0) + 1)
  }

  // Pass 1: types with a first letter no other type shares keep it.
  for (const type of types) {
    if (firstLetterCounts.get(type[0]) === 1) {
      keyByType.set(type, type[0])
      used.add(type[0])
    }
  }

  // Pass 2: collisions take the next free letter from their name, else any free letter.
  for (const type of types) {
    if (keyByType.has(type)) continue
    const key = [...type].find((ch) => !used.has(ch)) ?? [...'abcdefghijklmnopqrstuvwxyz'].find((ch) => !used.has(ch))!
    keyByType.set(type, key)
    used.add(key)
  }

  return types.map((type) => ({ type, key: keyByType.get(type)! }))
}

// clack-style glyphs, matching the look of the confirm prompts above.
const S_BAR = '│'
const S_BAR_END = '└'

function stepSymbol(state: string): string {
  if (state === 'submit') return colors.green('◇')
  if (state === 'cancel') return colors.red('■')
  return colors.cyan('◆')
}

/** Render a type name with its hotkey letter underlined (e.g. dr{i}nk); dimmed when not active. */
function renderTypeLabel(type: string, key: string, active: boolean): string {
  const i = type.indexOf(key)
  const word =
    i < 0 ? `${type} ${colors.dim(`(${key})`)}` : type.slice(0, i) + colors.underline(type[i]) + type.slice(i + 1)
  return active ? word : colors.dim(word)
}

/**
 * Arrow-navigable type picker with type-ahead: ↑/↓ move the cursor (Enter confirms),
 * and pressing a type's hotkey selects it immediately. Built on @clack/core's
 * SelectPrompt because @clack/prompts' select offers no type-ahead and selectKey
 * offers no arrow navigation — this wants both.
 */
function pickType(
  message: string,
  choices: Array<{ type: string; key: string }>,
  initialType: string,
): Promise<string | symbol> {
  const options = choices.map(({ type, key }) => ({ value: type, key }))

  const prompt = new SelectPrompt<{ value: string; key: string }>({
    options,
    initialValue: initialType,
    render() {
      const head = `${colors.gray(S_BAR)}\n${stepSymbol(this.state)}  ${message}\n`
      const current = this.options[this.cursor]
      if (this.state === 'submit') return `${head}${colors.gray(S_BAR)}  ${colors.dim(current.value)}`
      if (this.state === 'cancel') {
        return `${head}${colors.gray(S_BAR)}  ${colors.strikethrough(colors.dim(current.value))}`
      }
      const rows = this.options
        .map((opt, i) => {
          const active = i === this.cursor
          const dot = active ? colors.green('●') : colors.dim('○')
          return `${colors.cyan(S_BAR)}  ${dot} ${renderTypeLabel(opt.value, opt.key, active)}`
        })
        .join('\n')
      return `${head}${rows}\n${colors.cyan(S_BAR_END)}\n`
    },
  })

  // Type-ahead: a matching hotkey jumps the cursor there and submits immediately.
  prompt.on('key', (char) => {
    const idx = options.findIndex((o) => o.key === char)
    if (idx === -1) return
    prompt.cursor = idx
    prompt.value = options[idx].value
    prompt.state = 'submit'
  })

  return prompt.prompt()
}

async function writeAndOpenPlace(file: string, doc: PlaceDocument): Promise<void> {
  const markdown = doc.toMarkdown()
  await outputFile(file, markdown)
  openEditor([{ file, line: markdown.split('\n').length }])
}
