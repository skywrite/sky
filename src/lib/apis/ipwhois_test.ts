import { assert, test } from '#test'
import { fetchIpLocation } from './ipwhois.ts'

test({ name: fetchIpLocation.name, ignore: true }, async () => {
  const given = '' // has no parameters
  const should = 'return an object with IpLocationResult fields'

  const result = await fetchIpLocation()

  // non-standard way of doing this
  const keys = ['country', 'country_code', 'region', 'city', 'latitude', 'longitude']
  const actual = Object.keys(result).every((key) => keys.includes(key))
  const expected = true

  assert({ given, should, expected, actual })
})
