import * as path from 'node:path'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
// import { fetchIpLocation } from '#lib/apis/ipwhois.ts'
import { toUTCDateString } from '#universal/dates/dates.ts'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import { parseCsv, stringifyCsv } from '#universal/encoding/csv/mod.ts'
import fetchDeviceLocation from './location/fetchDeviceLocation.ts'
import { assembleGoogleAddressComponents, fetchGoogleGeocode } from './location/fetchGoogleGeocode.ts'
import fetchMobileLocation from './location/fetchMobileLocation.ts'

// TODO: if 'when' is passed (i.e. history)
// should insert into records as opposed to append to the end

const params = {
  notes: Arg.string('Why I am in this location?', { default: '' }),
  lat: Flag.string('Latitude'),
  long: Flag.string('Longitude'),
  mobile: Flag.bool('Use mobile device location via QR code', { default: false }),
  when: Flag.plainDateTime('Date/time in reverse format', { default: () => new PlainDateTime() }),
}

type Params = InferParams<typeof params>

export default class UtilLocationTask extends Command {
  static override description: CommandDescription = {
    name: 'util:location',
    description: 'Record latest location.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, env, output } = context
    const { when, notes, lat, long, mobile } = args

    if (lat && !long) {
      output.error('You have lat defined, but not long. Pass in long.')
      return CommandResult.error('Missing longitude - both lat and long are required')
    }

    if (long && !lat) {
      output.error('You have long defined, but not lat. Pass in lat.')
      return CommandResult.error('Missing latitude - both lat and long are required')
    }

    // get location data
    // const ipLocationData = await fetchIpLocation()

    let latitude: number = lat ? parseFloat(lat) : 0
    let longitude: number = long ? parseFloat(long) : 0

    if (!latitude && !longitude) {
      // If --mobile flag is passed, use QR code method
      if (mobile) {
        output.log('Opening QR code for mobile location...')
        const mobileLocationData = await fetchMobileLocation(env.NGROK_AUTH)
        latitude = mobileLocationData.latitude
        longitude = mobileLocationData.longitude
      } else {
        // Default: try to use device-location command
        const deviceLocationData = await fetchDeviceLocation()

        if (deviceLocationData) {
          latitude = deviceLocationData.latitude
          longitude = deviceLocationData.longitude
        } else {
          output.error('device-location command not found. Use --mobile flag to get location via QR code.')
          return CommandResult.error('Unable to fetch location. Install device-location or use --mobile flag.')
        }
      }
    }

    const googleData = await fetchGoogleGeocode(latitude, longitude, env.GOOGLE_MAPS_KEY)

    const locationData = assembleGoogleAddressComponents(googleData?.results[0]?.address_components)
    locationData.latitude = latitude
    locationData.longitude = longitude

    // If no notes arg passed, just output current location and exit
    if (!notes) {
      const locationParts = [locationData.subcity, locationData.city, locationData.region, locationData.country].filter(
        Boolean,
      )
      output.log(`     lat: ${latitude}`)
      output.log(`     lng: ${longitude}`)
      output.log(`location: ${locationParts.join(', ')}`)
      return CommandResult.success()
    }

    // The CSV stores UTC; the zone-less `when` reads in the system zone —
    // the interpretation the old Date bridge made silently, now explicit.
    const whenDateVal = new ZonedDateTime(when, currentTimezoneIANA()).toDateValue()
    const nowUTCStr = toUTCDateString(whenDateVal)
    const csvFile = path.join(<string>config.DIR_DATA_LOCATION, String(when.plainDate.year), 'location.csv')

    const columns = ['when', 'country', 'country_code', 'region', 'city', 'latitude', 'longitude', 'notes']
    const csvExists = await exists(csvFile)
    if (!csvExists) {
      const headerString = columns.join(',')
      const emptyCsvData = `${headerString}\n`
      await outputFile(csvFile, emptyCsvData)
    }

    let csvData = await readTextFile(csvFile)
    // we skip the 1st roaw if we read the text file, otherwise don't
    const csvRecords = parseCsv(csvData).records as Record<string, unknown>[]

    // TODO: if 'when' is passed (i.e. history)
    // should insert into records as opposed to append to the end

    if (csvRecords.length > 0) {
      const lastRecord = csvRecords.at(-1)
      if (lastRecord) {
        const ld = locationData
        if (
          ld.city === lastRecord.city &&
          ld.region === lastRecord.region &&
          ld.country_code === lastRecord.country_code
        ) {
          // return console.log('\n  Location has not changed.\n')
        }
      }
    }

    const newRecord = { ...locationData, when: nowUTCStr, notes }
    csvRecords.push(newRecord)

    csvData = stringifyCsv(csvRecords, columns)
    await outputFile(csvFile, csvData)

    output.log(`Updated location: ${locationData.city}, ${locationData.region}, ${locationData.country}`)

    return CommandResult.success()
  }
}
