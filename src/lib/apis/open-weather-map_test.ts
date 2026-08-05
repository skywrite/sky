import isOnline from '#shared/network/isOnline.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { fetchWeather } from './open-weather-map.ts'

// Live API call — needs a key (absent on CI) and network.
const ignore = !env.get('OPEN_WEATHER_MAP') || !(await isOnline())

test({ name: fetchWeather.name, ignore }, async () => {
  const given = 'lat and lon' // has no parameters
  const should = 'return an object with weather fields'

  const location = {
    latitude: 40.8258,
    longitude: -96.6852,
  }

  const result = await fetchWeather(location)

  assert({
    given,
    should,
    expected: true,
    actual: result.name.includes('Lincoln'),
  })

  assert({
    given,
    should,
    expected: true,
    // fucking hot or fucking cold in Lincoln, NE
    actual: result.main.temp > -30 && result.main.temp < 120,
  })
})
