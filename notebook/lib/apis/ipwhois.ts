// https://ipwhois.io/documentation

const URL = 'http://ipwho.is/?fields=country,country_code,city,region,latitude,longitude'

export interface IpLocationResult {
  country: string
  country_code: string
  region: string
  city: string
  latitude: number
  longitude: number
}

export async function fetchIpLocation(): Promise<IpLocationResult> {
  const result = await fetch(URL)
  const jsonResult: IpLocationResult = await result.json()
  return jsonResult
}
