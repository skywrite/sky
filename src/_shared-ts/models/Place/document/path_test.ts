import { assert, test } from '#test'
import { buildPlacePath, deslugify, parsePlacePath, toDisplayString } from './path.ts'
import type { PlaceLocation, PlacePathComponents } from './types.ts'

// deslugify fixtures
const deslugifyFixtures = [
  { input: 'New-York', expected: 'New York' },
  { input: 'Zona-Hotelera', expected: 'Zona Hotelera' },
  { input: 'Tokyo', expected: 'Tokyo' },
  { input: 'Los-Angeles', expected: 'Los Angeles' },
]

for (const { input, expected } of deslugifyFixtures) {
  test(`deslugify: ${input} -> ${expected}`, () => {
    assert({
      given: `slug "${input}"`,
      should: `return "${expected}"`,
      actual: deslugify(input),
      expected,
    })
  })
}

// buildPlacePath fixtures (without places/ prefix - that's added by toPath())
const buildPathFixtures: Array<{ location: PlaceLocation; type: string; expected: string; description: string }> = [
  {
    description: 'US location with subcity',
    location: {
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7128,
      longitude: -74.006,
    },
    type: 'drink',
    expected: 'US/NY/New-York/Manhattan/drink',
  },
  {
    description: 'Japan location',
    location: {
      country: 'JP',
      region: 'Tokyo',
      subcity: 'Ginza',
      latitude: 35.6762,
      longitude: 139.6503,
    },
    type: 'eat',
    expected: 'JP/Tokyo/Ginza/eat',
  },
  {
    description: 'Mexico location',
    location: {
      country: 'MX',
      city: 'Cancun',
      subcity: 'Zona Hotelera',
      latitude: 21.1619,
      longitude: -86.8515,
    },
    type: 'stay',
    expected: 'MX/Cancun/Zona-Hotelera/stay',
  },
  {
    description: 'Poland location without subcity',
    location: {
      country: 'PL',
      city: 'Kraków',
      latitude: 50.0647,
      longitude: 19.945,
    },
    type: 'eat',
    expected: 'PL/Kraków/eat',
  },
]

for (const { description, location, type, expected } of buildPathFixtures) {
  test(`buildPlacePath: ${description}`, () => {
    assert({
      given: description,
      should: `return "${expected}"`,
      actual: buildPlacePath(location, type),
      expected,
    })
  })
}

// parsePlacePath fixtures
const parsePathFixtures: Array<{ input: string; expected: PlacePathComponents }> = [
  {
    input: 'places/US/NY/New-York/Manhattan/drink/Ty-Bar',
    expected: { country: 'US', region: 'NY', city: 'New-York', subcity: 'Manhattan', type: 'drink', slug: 'Ty-Bar' },
  },
  {
    input: 'places/JP/Tokyo/Ginza/eat/Sukiyabashi-Jiro',
    expected: { country: 'JP', region: 'Tokyo', subcity: 'Ginza', type: 'eat', slug: 'Sukiyabashi-Jiro' },
  },
  {
    input: 'places/MX/Cancun/Zona-Hotelera/stay/Hotel',
    expected: { country: 'MX', city: 'Cancun', subcity: 'Zona-Hotelera', type: 'stay', slug: 'Hotel' },
  },
  {
    input: 'places/PL/Krakow/eat/Trattoria',
    expected: { country: 'PL', city: 'Krakow', type: 'eat', slug: 'Trattoria' },
  },
]

for (const { input, expected } of parsePathFixtures) {
  test(`parsePlacePath: ${input}`, () => {
    assert({
      given: `path "${input}"`,
      should: 'parse correctly',
      actual: parsePlacePath(input),
      expected,
    })
  })
}

// toDisplayString fixtures
const displayStringFixtures: Array<{ input: PlacePathComponents; expected: string }> = [
  {
    input: { country: 'US', region: 'NY', city: 'New-York', subcity: 'Manhattan' },
    expected: 'Manhattan, New York, NY',
  },
  {
    input: { country: 'JP', region: 'Tokyo', subcity: 'Ginza' },
    expected: 'Ginza, Tokyo, JP',
  },
  {
    input: { country: 'MX', city: 'Cancun', subcity: 'Zona-Hotelera' },
    expected: 'Zona Hotelera, Cancun, MX',
  },
  {
    input: { country: 'PL', city: 'Kraków' },
    expected: 'Kraków, PL',
  },
]

for (const { input, expected } of displayStringFixtures) {
  test(`toDisplayString: ${expected}`, () => {
    assert({
      given: `location components`,
      should: `return "${expected}"`,
      actual: toDisplayString(input),
      expected,
    })
  })
}
