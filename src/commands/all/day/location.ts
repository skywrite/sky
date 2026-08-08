import { Command, CommandResult, dayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import fetchDeviceLocation from '../util/location/fetchDeviceLocation.ts'
import {
  assembleGoogleAddressComponents,
  buildPlacePath,
  fetchGoogleGeocode,
} from '../util/location/fetchGoogleGeocode.ts'
import fetchMobileLocation from '../util/location/fetchMobileLocation.ts'

const params = {
  day: dayArg(),
  lat: Flag.string('Latitude'),
  long: Flag.string('Longitude'),
  mobile: Flag.bool('Use mobile device location via QR code', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:location': { params: Params; result: undefined }
  }
}

export default class DayLocationTask extends Command {
  static override description: CommandDescription = {
    name: 'day:location',
    description: 'Set location on day document.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { env, output } = context
    const { day, lat, long, mobile } = args

    if (lat && !long) {
      return CommandResult.error('Missing longitude - both lat and long are required')
    }
    if (long && !lat) {
      return CommandResult.error('Missing latitude - both lat and long are required')
    }

    // Get coordinates
    let latitude: number = lat ? parseFloat(lat) : 0
    let longitude: number = long ? parseFloat(long) : 0

    if (!latitude && !longitude) {
      if (mobile) {
        output.log('Opening QR code for mobile location...')
        const mobileLocationData = await fetchMobileLocation(env.NGROK_AUTH)
        latitude = mobileLocationData.latitude
        longitude = mobileLocationData.longitude
      } else {
        const deviceLocationData = await fetchDeviceLocation()
        if (deviceLocationData) {
          latitude = deviceLocationData.latitude
          longitude = deviceLocationData.longitude
        } else {
          return CommandResult.error('Unable to fetch location. Install device-location or use --mobile flag.')
        }
      }
    }

    // Reverse geocode
    const googleData = await fetchGoogleGeocode(latitude, longitude, env.GOOGLE_MAPS_KEY)
    const locationData = assembleGoogleAddressComponents(googleData?.results[0]?.address_components)

    // Build place path
    const placePath = buildPlacePath(locationData)

    // Update day document
    const targetDay = day ?? PlainDate.today()
    let dayModel = await readDay(targetDay)
    dayModel = dayModel.setLocation(placePath)
    await writeDay(dayModel)

    output.log(`Set location: ${placePath}`)

    return CommandResult.success()
  }
}
