import { assert, test } from '#test'
import PlaceDocument from './mod.ts'

test('PlaceDocument.toPath: US location', () => {
  const doc = PlaceDocument.create({
    name: 'Ty Bar',
    type: 'drink',
    location: {
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7614,
      longitude: -73.9747,
    },
  })

  assert({
    given: 'US place',
    should: 'build correct path',
    actual: doc.toPath(),
    expected: 'places/US/NY/New-York/Manhattan/drink/Ty-Bar',
  })
})

test('PlaceDocument.toPath: Japan location', () => {
  const doc = PlaceDocument.create({
    name: 'Sukiyabashi Jiro',
    type: 'eat',
    location: {
      country: 'JP',
      region: 'Tokyo',
      subcity: 'Ginza',
      latitude: 35.6762,
      longitude: 139.6503,
    },
  })

  assert({
    given: 'Japan place',
    should: 'build correct path',
    actual: doc.toPath(),
    expected: 'places/JP/Tokyo/Ginza/eat/Sukiyabashi-Jiro',
  })
})

test('PlaceDocument.toLocationDisplayString: US location', () => {
  const doc = PlaceDocument.create({
    name: 'Ty Bar',
    type: 'drink',
    location: {
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7614,
      longitude: -73.9747,
    },
  })

  assert({
    given: 'US place',
    should: 'display location correctly',
    actual: doc.toLocationDisplayString(),
    expected: 'Manhattan, New York, NY',
  })
})

test('PlaceDocument.toFilePath: US location (no places/ prefix)', () => {
  const doc = PlaceDocument.create({
    name: 'Ty Bar',
    type: 'drink',
    location: {
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7614,
      longitude: -73.9747,
    },
  })

  assert({
    given: 'US place',
    should: 'build file path without places/ prefix',
    actual: doc.toFilePath(),
    expected: 'US/NY/New-York/Manhattan/drink/Ty-Bar',
  })
})

test('PlaceDocument.toFilePath: Japan location (no places/ prefix)', () => {
  const doc = PlaceDocument.create({
    name: 'Sukiyabashi Jiro',
    type: 'eat',
    location: {
      country: 'JP',
      region: 'Tokyo',
      subcity: 'Ginza',
      latitude: 35.6762,
      longitude: 139.6503,
    },
  })

  assert({
    given: 'Japan place',
    should: 'build file path without places/ prefix',
    actual: doc.toFilePath(),
    expected: 'JP/Tokyo/Ginza/eat/Sukiyabashi-Jiro',
  })
})

// Regression test: Prevent places/places/ double-prefix bug
test('PlaceDocument: toFilePath vs toPath prefix difference', () => {
  const doc = PlaceDocument.create({
    name: 'Test Place',
    type: 'eat',
    location: {
      country: 'MX',
      city: 'Cancun',
      subcity: 'Zona Hotelera',
      latitude: 21.1619,
      longitude: -86.8515,
    },
  })

  const toPath = doc.toPath()
  const toFilePath = doc.toFilePath()

  assert({
    given: 'a place document',
    should: 'toPath() starts with places/',
    actual: toPath.startsWith('places/'),
    expected: true,
  })

  assert({
    given: 'a place document',
    should: 'toFilePath() does NOT start with places/',
    actual: toFilePath.startsWith('places/'),
    expected: false,
  })

  assert({
    given: 'a place document',
    should: 'toPath() equals places/ + toFilePath()',
    actual: toPath,
    expected: `places/${toFilePath}`,
  })
})
