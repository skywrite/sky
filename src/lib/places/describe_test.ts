import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { describeFound, describePlace } from './describe.ts'
import type { FoundGeography } from './locations.ts'

const RECORDS: Record<string, string> = {
  'US.md': 'name: United States\nkind: country\nref: places/US\nlocation:\n  country: US',
  'US/VT.md':
    'name: Vermont\nkind: region\nref: places/US/VT\nparent: places/US\nlocation:\n  country: US\n  region: VT',
  'US/VT/Burlington.md':
    'name: Burlington\nkind: city\nref: places/US/VT/Burlington\nparent: places/US/VT\nlocation:\n  country: US\n  region: VT\n  city: Burlington',
  'US/VT/Burlington/Old-North-End.md':
    'name: Old North End\nkind: neighborhood\nref: places/US/VT/Burlington/Old-North-End\nparent: places/US/VT/Burlington',
  // A venue with no parent belongs to the closest saved geography in its reference
  'US/VT/Burlington/Old-North-End/drink/Sample-Cafe.md':
    'name: Sample Cafe\ntype: drink\nlocation:\n  country: US\n  region: VT\n  city: Burlington',
  'FR/Paris.md':
    'name: Paris\nkind: city\nref: places/FR/Paris\nparent: places/FR\nlocation:\n  country: FR\n  city: Paris',
  'GB.md': 'name: United Kingdom\nkind: country\nref: places/GB\nlocation:\n  country: GB',
  'GB/Manchester.md': 'name: Manchester\nkind: city\nref: places/GB/Manchester\nparent: places/GB',
  'JP/Osaka.md':
    'name: Osaka\nkind: region\nref: places/JP/Osaka\nparent: places/JP\nlocation:\n  country: JP\n  region: Osaka',
  // Filed straight under its country, but its metadata names its province
  'CA/Halifax.md':
    'name: Halifax\nkind: city\nref: places/CA/Halifax\nparent: places/CA\nlocation:\n  country: CA\n  region: NS',
  'MC/Monaco.md': 'name: Monaco\nkind: city\nref: places/MC/Monaco\nparent: places/MC\nlocation:\n  country: MC',
}

test('a place reads as its name, the places containing it, then its country', async () => {
  const dir = await mkdtemp('/tmp/sky-place-describe-')
  try {
    const store = await PlaceStore.build(dir)
    for (const [file, yaml] of Object.entries(RECORDS))
      store.set(path.join(dir, 'locations', file), `---\n${yaml}\n---\n`)
    const read = (ref: string) => describePlace(store, ref)
    assert({
      given: 'a US city inside its saved state and country',
      should: 'read with the state code and USA',
      actual: [
        read('places/US/VT/Burlington'),
        read('places/us/vt/burlington/'),
        read('places/US/VT'),
        read('places/US'),
      ],
      expected: ['Burlington, VT, USA', 'Burlington, VT, USA', 'Vermont, USA', 'United States'],
    })
    assert({
      given: 'a neighborhood, and a venue with no saved parent of its own',
      should: 'read through every containing place',
      actual: [
        read('places/US/VT/Burlington/Old-North-End'),
        read('places/US/VT/Burlington/Old-North-End/drink/Sample-Cafe'),
      ],
      expected: ['Old North End, Burlington, VT, USA', 'Sample Cafe, Old North End, Burlington, VT, USA'],
    })
    assert({
      given: 'cities in countries that are and are not saved, a region outside the US, and a city-state',
      should: 'end with the country as people write it, naming a region only where it reads naturally',
      actual: [
        read('places/FR/Paris'),
        read('places/GB/Manchester'),
        read('places/JP/Osaka'),
        read('places/CA/Halifax'),
        read('places/MC/Monaco'),
      ],
      expected: ['Paris, France', 'Manchester, UK', 'Osaka, Japan', 'Halifax, NS, Canada', 'Monaco'],
    })
    assert({
      given: 'a link to a place with no record, a recognized country with no record, and text from before places',
      should: 'read the link from its path, the country by its name, and the text as written',
      actual: [
        read('places/US/VT/Winooski'),
        read('places/GB/England/Leeds'),
        read('places/SE'),
        read('places/CN'),
        read('  Somewhere, VT, USA '),
      ],
      expected: ['Winooski, VT, USA', 'Leeds, England, UK', 'Sweden', 'China', 'Somewhere, VT, USA'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a place found on Google Maps reads as it will once saved, never in its postal form', () => {
  const found = (input: Partial<FoundGeography>): FoundGeography => ({
    kind: 'city',
    name: 'Winooski',
    country: 'US',
    region: { code: 'VT', name: 'Vermont' },
    ...input,
  })
  assert({
    given:
      'a US city, a neighborhood, a county, a state, a country, a UK city, and a city whose region is not part of its places',
    should: 'read with the state code in the US, the region name in the UK, and only the country elsewhere',
    actual: [
      describeFound(found({})),
      describeFound(found({ kind: 'neighborhood', name: 'Old North End', city: 'Burlington' })),
      describeFound(found({ kind: 'area', name: 'Chittenden County' })),
      describeFound(found({ kind: 'region', name: 'Vermont' })),
      describeFound(found({ kind: 'country', name: 'United States', region: undefined })),
      describeFound(found({ name: 'Manchester', country: 'GB', region: { code: 'England', name: 'England' } })),
      describeFound(found({ name: 'Verona', country: 'IT', region: { code: 'Veneto', name: 'Veneto' } })),
      describeFound(found({ name: 'Monaco', country: 'MC', region: undefined })),
    ],
    expected: [
      'Winooski, VT, USA',
      'Old North End, Burlington, VT, USA',
      'Chittenden County, VT, USA',
      'Vermont, USA',
      'United States',
      'Manchester, England, UK',
      'Verona, Italy',
      'Monaco',
    ],
  })
})
