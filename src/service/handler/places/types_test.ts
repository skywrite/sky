import { assert, test } from '#test'
import { blankPlace, placeMapHref } from './types.ts'

test('Saved Google Maps links take precedence over generated coordinate searches', () => {
  const links = [
    'https://maps.google.com/?cid=424242',
    'http://maps.google.com/?cid=424242',
    'https://www.google.com/maps?cid=424242',
    'https://www.google.co.uk/maps/place/Atlas+Cafe',
    'https://maps.app.goo.gl/ExampleAtlasPlace',
    'https://goo.gl/maps/ExampleAtlasPlace',
  ]
  const place = {
    ...blankPlace(),
    name: 'Atlas Cafe',
    googlePlaceId: 'sample-place-id',
    coordinates: { latitude: 48.85837, longitude: 2.294481 },
  }
  assert({
    given: 'saved Maps URLs in full, legacy and short-link formats',
    should: 'preserve each saved destination exactly',
    actual: links.map((googleMapsUrl) => placeMapHref({ ...place, googleMapsUrl })),
    expected: links,
  })
})

test('A missing or unusable saved Maps link keeps the location search fallback', () => {
  const place = {
    ...blankPlace(),
    name: 'Atlas Cafe',
    address: '12 Example Street',
    googlePlaceId: 'sample-place-id',
    coordinates: { latitude: 48.85837, longitude: 2.294481 },
  }
  for (const googleMapsUrl of ['', 'not a URL', 'javascript:alert(1)', 'https://user:password@example.com/']) {
    const url = new URL(placeMapHref({ ...place, googleMapsUrl }))
    assert({
      given: 'no usable saved web link',
      should: 'open the known place at its coordinates',
      actual: [url.origin, url.pathname, url.searchParams.get('query'), url.searchParams.get('query_place_id')],
      expected: ['https://www.google.com', '/maps/search/', '48.85837,2.294481', 'sample-place-id'],
    })
  }
  const url = new URL(placeMapHref({ ...place, coordinates: null, googlePlaceId: '' }))
  assert({
    given: 'a place without a saved link, provider ID or coordinates',
    should: 'search by the place name and address',
    actual: url.searchParams.get('query'),
    expected: 'Atlas Cafe, 12 Example Street',
  })
})
