import * as path from 'node:path'
import { DIR_DATA_LOCATION } from '#config'
import readTextFile from '#shared/fs/readTextFile.ts'
import { parseCsv } from '#universal/encoding/csv/mod.ts'

export type Location = {
  country: string
  countryCode: string
  region: string
  city: string
  latitude: number
  longitude: number
}

// TODO: support times
export async function fetchLocation(): Promise<Location> {
  console.warn(
    'WARNING: fetchLocation() likely has regressions introduced by switching from IP location to mobile GPS.',
  )

  const when = new Date() // support as input
  const year = when.getFullYear()
  const csvFile = path.join(DIR_DATA_LOCATION, String(year), 'location.csv')

  const csvData = await readTextFile(csvFile)
  const csvRecords = parseCsv(csvData).records
  const lastRecord = csvRecords.at(-1) as Record<string, unknown>

  const loc: Location = {
    country: <string>lastRecord.country,
    countryCode: <string>lastRecord.country_code,
    region: <string>lastRecord.region,
    city: <string>lastRecord.city,
    latitude: parseFloat(<string>lastRecord.latitude),
    longitude: parseFloat(<string>lastRecord.longitude),
  }

  return loc
}
