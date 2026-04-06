import { assert, test } from '#test'
import { readTextFile } from '#shared/fs/mod.ts'
import PlaceDocument from './mod.ts'
import type { PlaceCreateInput } from './types.ts'

const FIXTURES_DIR = new URL('./fixtures', import.meta.url).pathname

async function loadFixture(name: string): Promise<PlaceDocument> {
  const content = await readTextFile(`${FIXTURES_DIR}/${name}.md`)
  return PlaceDocument.fromMarkdown(content)
}

// ---------------------------------------------------------------------------
// New format fixtures
// ---------------------------------------------------------------------------

const newFormatFixtures = [
  {
    description: 'new format US place (Ty Bar, Manhattan)',
    file: 'new-format-us',
    expected: {
      name: 'Ty Bar',
      type: 'drink',
      country: 'US',
      region: 'NY',
      city: 'New York',
      subcity: 'Manhattan',
      latitude: 40.7614,
      longitude: -73.9747,
      googleMapsUrl: 'https://maps.google.com/?cid=123456789',
      displayString: 'Manhattan, New York, NY',
    },
  },
  {
    description: 'new format Poland place (Trattoria Degusti, Kraków)',
    file: 'new-format-poland',
    expected: {
      name: 'Trattoria Degusti',
      type: 'eat',
      country: 'PL',
      region: undefined,
      city: 'Kraków',
      subcity: undefined,
      latitude: 50.063703,
      longitude: 19.940385,
      googleMapsUrl: 'https://maps.google.com/?cid=987654321',
      displayString: 'Kraków, PL',
    },
  },
]

newFormatFixtures.forEach(({ description, file, expected }) => {
  test(`PlaceDocument new format: ${description}`, async () => {
    const doc = await loadFixture(file)

    assert({ given: description, should: 'parse name', actual: doc.name, expected: expected.name })
    assert({ given: description, should: 'parse type', actual: doc.type, expected: expected.type })
    assert({ given: description, should: 'parse country', actual: doc.location?.country, expected: expected.country })
    assert({ given: description, should: 'parse region', actual: doc.location?.region, expected: expected.region })
    assert({ given: description, should: 'parse city', actual: doc.location?.city, expected: expected.city })
    assert({ given: description, should: 'parse subcity', actual: doc.location?.subcity, expected: expected.subcity })
    assert({
      given: description,
      should: 'parse latitude',
      actual: doc.location?.latitude,
      expected: expected.latitude,
    })
    assert({
      given: description,
      should: 'parse longitude',
      actual: doc.location?.longitude,
      expected: expected.longitude,
    })
    assert({
      given: description,
      should: 'parse googleMapsUrl',
      actual: doc.googleMapsUrl,
      expected: expected.googleMapsUrl,
    })
    assert({
      given: description,
      should: 'generate display string',
      actual: doc.toLocationDisplayString(),
      expected: expected.displayString,
    })
  })
})

// ---------------------------------------------------------------------------
// Legacy format fixtures
// ---------------------------------------------------------------------------

const legacyFixtures = [
  {
    description: 'legacy US place (Chart Room, Homer AK)',
    file: 'legacy-format-us',
    expected: {
      name: 'The Chart Room Restaurant',
      country: 'US',
      region: 'AK',
      city: 'Homer',
      latitude: 59.60081,
      longitude: -151.40957,
      googleMapsUrl: 'https://maps.google.com/?cid=14476323636222395284',
      displayString: 'Homer, AK',
    },
  },
  {
    description: 'legacy GB place (University Arms, Cambridge)',
    file: 'legacy-format-gb',
    expected: {
      name: 'University Arms Hotel, Autograph Collection',
      country: 'GB',
      region: 'England',
      city: 'Cambridge',
      latitude: 52.2019338,
      longitude: 0.125055,
      googleMapsUrl: 'https://maps.google.com/?cid=9183334280614569887',
      displayString: 'Cambridge, England',
    },
  },
  {
    description: 'legacy SG place (Fat Cow, Singapore)',
    file: 'legacy-format-sg',
    expected: {
      name: 'Fat Cow',
      country: 'SG',
      region: undefined,
      city: 'Singapore',
      latitude: 1.3063,
      longitude: 103.8292,
      googleMapsUrl: 'https://maps.google.com/?cid=12345',
      displayString: 'Singapore, SG',
    },
  },
]

legacyFixtures.forEach(({ description, file, expected }) => {
  test(`PlaceDocument legacy format: ${description}`, async () => {
    const doc = await loadFixture(file)

    assert({ given: description, should: 'parse name', actual: doc.name, expected: expected.name })
    assert({
      given: description,
      should: 'resolve country from addressComponents',
      actual: doc.location?.country,
      expected: expected.country,
    })
    assert({
      given: description,
      should: 'resolve region from addressComponents.state',
      actual: doc.location?.region,
      expected: expected.region,
    })
    assert({
      given: description,
      should: 'resolve city from addressComponents',
      actual: doc.location?.city,
      expected: expected.city,
    })
    assert({
      given: description,
      should: 'parse latitude',
      actual: doc.location?.latitude,
      expected: expected.latitude,
    })
    assert({
      given: description,
      should: 'parse longitude',
      actual: doc.location?.longitude,
      expected: expected.longitude,
    })
    assert({
      given: description,
      should: 'resolve googleMapsUrl from GoogleMaps.url',
      actual: doc.googleMapsUrl,
      expected: expected.googleMapsUrl,
    })
    assert({
      given: description,
      should: 'generate correct display string',
      actual: doc.toLocationDisplayString(),
      expected: expected.displayString,
    })
  })
})

// ---------------------------------------------------------------------------
// Markdown roundtrip
// ---------------------------------------------------------------------------

test('PlaceDocument: markdown roundtrip', () => {
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

  const doc1 = PlaceDocument.create(input)
  const markdown = doc1.toMarkdown()
  const doc2 = PlaceDocument.fromMarkdown(markdown)

  assert({
    given: 'roundtrip through markdown',
    should: 'preserve name',
    actual: doc2.name,
    expected: doc1.name,
  })

  assert({
    given: 'roundtrip through markdown',
    should: 'preserve type',
    actual: doc2.type,
    expected: doc1.type,
  })

  assert({
    given: 'roundtrip through markdown',
    should: 'preserve location',
    actual: doc2.location?.country,
    expected: doc1.location?.country,
  })

  assert({
    given: 'roundtrip through markdown',
    should: 'preserve coordinates',
    actual: doc2.location?.latitude,
    expected: doc1.location?.latitude,
  })
})
