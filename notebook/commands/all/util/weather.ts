import { Command, CommandResult } from '#commands/mod.ts'
import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { parseCsv, stringifyCsv } from '#universal/encoding/csv/mod.ts'
import { fetchWeather } from '#lib/apis/open-weather-map.ts'
import { fetchLocation } from '#lib/misc/location.ts'
import { dateToLocalString } from '#universal/dates/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { DIR_TRACKING_LOCATION } from '#config'

export default class UtilWeatherTask extends Command {
  static override description: CommandDescription = {
    name: 'util:weather',
    description: 'Record weather at current location.',
  }

  async run({ context, tasks }: CommandArgs): Promise<CommandResult> {
    const { output, config } = context
    const now = new Date()
    const year = now.getFullYear()
    const nowStr = dateToLocalString(now)
    const csvFile = path.join(<string>config.DIR_TRACKING_WEATHER, String(year), 'weather.csv')

    // Ensure location data exists for the current year
    const locationFile = path.join(DIR_TRACKING_LOCATION, String(year), 'location.csv')
    if (!(await exists(locationFile))) {
      output.log('Location data not found for current year, fetching location...')
      await tasks?.run('util:location', { notes: 'start of the year' })
    }

    const columns = [
      'city',
      'when',
      'description',
      'temp',
      'temp_feels_like',
      'temp_min',
      'temp_max',
      'pressure',
      'humidity',
      'wind_speed',
      'sunrise',
      'sunset',
    ]

    const csvExists = await exists(csvFile)
    if (!csvExists) {
      const headerString = columns.join(',')
      const emptyCsvData = `${headerString}\n`
      await outputFile(csvFile, emptyCsvData)
    }

    let csvData = ''
    let csvRecords: Record<string, unknown>[] = []

    csvData = await readTextFile(csvFile)

    // we skip the 1st row if we read the text file, otherwise don't
    csvRecords = parseCsv(csvData).records as Record<string, unknown>[]

    const location = await fetchLocation()
    const weatherData = await fetchWeather(location)

    // output.log(JSON.stringify(weatherData, null, 2))

    const newRecord = {
      city: weatherData.name,
      when: nowStr,
      description: weatherData.weather[0].description,
      temp: weatherData.main.temp,
      temp_feels_like: weatherData.main.feels_like,
      temp_min: weatherData.main.temp_min,
      temp_max: weatherData.main.temp_max,
      pressure: weatherData.main.pressure,
      humidity: weatherData.main.humidity,
      wind_speed: weatherData.wind.speed,
      sunrise: dateToLocalString(weatherData.sys.sunrise),
      sunset: dateToLocalString(weatherData.sys.sunset),
    }

    csvRecords.push(newRecord)

    csvData = stringifyCsv(csvRecords, columns)
    await outputFile(csvFile, csvData)

    return CommandResult.success()
  }
}
