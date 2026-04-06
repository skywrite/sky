import { assert, test } from '#test'
import PlaceDocument from './mod.ts'
import type { PlaceCreateInput } from './types.ts'

test('PlaceDocument.create: creates with all fields', () => {
  const input: PlaceCreateInput = {
    name: 'Ty Bar',
    type: 'drink',
    address: '2 E 55th St, New York, NY 10022',
    site: 'https://example.com',
    location: {
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7614,
      longitude: -73.9747,
      plusCode: '87G8Q2JM+XX',
    },
    googleMapsUrl: 'https://maps.google.com/?cid=123',
  }

  const doc = PlaceDocument.create(input)

  assert({
    given: 'PlaceCreateInput with all fields',
    should: 'set name correctly',
    actual: doc.name,
    expected: 'Ty Bar',
  })

  assert({
    given: 'PlaceCreateInput with all fields',
    should: 'set type correctly',
    actual: doc.type,
    expected: 'drink',
  })

  assert({
    given: 'PlaceCreateInput with all fields',
    should: 'set location country',
    actual: doc.location?.country,
    expected: 'US',
  })

  assert({
    given: 'PlaceCreateInput with all fields',
    should: 'set location coordinates',
    actual: doc.location?.latitude,
    expected: 40.7614,
  })
})

test('PlaceDocument.create: creates with minimal fields', () => {
  const input: PlaceCreateInput = {
    name: 'Restaurant',
    type: 'eat',
    location: {
      country: 'PL',
      city: 'Kraków',
      latitude: 50.0647,
      longitude: 19.945,
    },
  }

  const doc = PlaceDocument.create(input)

  assert({
    given: 'minimal PlaceCreateInput',
    should: 'set name',
    actual: doc.name,
    expected: 'Restaurant',
  })

  assert({
    given: 'minimal PlaceCreateInput',
    should: 'have undefined address',
    actual: doc.address,
    expected: undefined,
  })
})
