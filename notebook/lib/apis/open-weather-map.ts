import { env } from '#shared/sys/mod.ts'

export interface OpenWeatherMapResult {
  weather: [
    {
      main: string
      description: string
    },
  ]
  main: {
    temp: number // F
    feels_like: number
    temp_min: number
    temp_max: number
    pressure: number // hPa
    humidity: number // %
  }
  visibility: number
  wind: {
    speed: number // mph
    deg: number
    gust: number
  }
  sys: {
    sunrise: Date
    sunset: Date
  }
  name: string
}

export interface OpenWeatherMapParams {
  apiKey?: string
  longitude: number
  latitude: number
}

// e.g. // https://api.openweathermap.org/data/2.5/weather?units=imperial&lat=40.8257625&lon=-96.6851982&appid=${KEY}
export async function fetchWeather({
  apiKey = env.get('OPEN_WEATHER_MAP'),
  latitude,
  longitude,
}: OpenWeatherMapParams): Promise<OpenWeatherMapResult> {
  const urlParams = new URLSearchParams()
  urlParams.set('units', 'imperial') // 'metric' valid
  urlParams.set('appid', apiKey || '') // note, after registration it takes hours for it to work
  urlParams.set('lat', String(latitude))
  urlParams.set('lon', String(longitude))

  const url = new URL('https://api.openweathermap.org/data/2.5/weather')
  url.search = urlParams.toString()

  const resp = await fetch(url)
  const result: OpenWeatherMapResult = await resp.json()

  // convert sunrise / sunset to Date objects
  const sunrise: unknown = result.sys.sunrise
  result.sys.sunrise = new Date(<number>sunrise * 1000)
  const sunset: unknown = result.sys.sunset
  result.sys.sunset = new Date(<number>sunset * 1000)

  return result
}
