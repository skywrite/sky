import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import PlaceDocument from '#shared/models/Place/mod.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { ensureCityIn, ensureGeography, locationChoices, matchLocation, type FoundGeography } from './locations.ts'

const TODAY = '2026-02-12'

async function notebook(records: Record<string, string>, run: (dir: string, store: PlaceStore) => Promise<void>) {
  const dir = await mkdtemp('/tmp/sky-place-locations-')
  try {
    const store = await PlaceStore.build(dir)
    for (const [file, yaml] of Object.entries(records))
      store.set(path.join(dir, 'locations', file), `---\n${yaml}\n---\n`)
    await run(dir, store)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const VERMONT = {
  'US.md': 'name: United States\nkind: country\nref: places/US\nlocation:\n  country: US',
  'US/VT.md':
    'name: Vermont\nkind: region\nref: places/US/VT\nparent: places/US\nlocation:\n  country: US\n  region: VT',
  'US/VT/Burlington.md':
    'name: Burlington\nkind: city\nref: places/US/VT/Burlington\nparent: places/US/VT\nlocation:\n  country: US\n  region: VT\n  city: Burlington',
  'US/VT/Burlington/drink/Sample-Cafe.md': 'name: Sample Cafe\ntype: drink',
  'US/VT/Old.md': 'name: Old Region\nkind: region\nref: places/US/VT/Old\narchived: true',
}

test('locations list saved geography and every country, described, and match text people write', async () => {
  await notebook(VERMONT, async (dir, store) => {
    const choices = locationChoices(store)
    const burlington = choices.find((choice) => choice.ref === 'places/US/VT/Burlington')
    assert({
      given: 'saved geography, a venue, an archived region and countries with no record',
      should: 'offer the geography and countries, described, never the venue or the archived place',
      actual: {
        burlington,
        venue: choices.some((choice) => choice.name === 'Sample Cafe'),
        archived: choices.some((choice) => choice.name === 'Old Region'),
        sweden: choices.find((choice) => choice.ref === 'places/SE'),
      },
      expected: {
        burlington: {
          ref: 'places/US/VT/Burlington',
          label: 'Burlington, VT, USA',
          name: 'Burlington',
          aliases: [],
          kind: 'city',
        },
        venue: false,
        archived: false,
        sweden: {
          ref: 'places/SE',
          label: 'Sweden',
          name: 'Sweden',
          aliases: ['SE'],
          kind: 'country',
          needsCreation: true,
        },
      },
    })
    const match = (text: string) => matchLocation(store, text)?.ref
    assert({
      given: 'a description, a state written out, a country, a place link, and text naming no saved place',
      should: 'name the one saved place or country each means, and nothing for the rest',
      actual: [
        match('Burlington, VT, USA'),
        match('Burlington, Vermont, United States'),
        match('burlington'),
        match('Sweden'),
        match('places/us/vt/burlington'),
        match('Winooski, VT, USA'),
        match('Burlington, NH, USA'),
        match('Sample Cafe'),
      ],
      expected: [
        'places/US/VT/Burlington',
        'places/US/VT/Burlington',
        'places/US/VT/Burlington',
        'places/SE',
        'places/US/VT/Burlington',
        undefined,
        undefined,
        undefined,
      ],
    })
    assert({
      given: 'listing and matching, a country with no record among them',
      should: 'never write a file',
      actual: await readdir(dir),
      expected: [],
    })
  })
})

const found = (input: Partial<FoundGeography>): FoundGeography => ({
  kind: 'city',
  name: 'Winooski',
  country: 'US',
  region: { code: 'VT', name: 'Vermont' },
  coordinates: { latitude: 44.49, longitude: -73.19 },
  googlePlaceId: 'sample_city_id',
  googleMapsUrl: 'https://maps.google.com/?cid=1',
  ...input,
})

test('a place found on Google Maps is saved inside its state and country, reusing what exists', async () => {
  await notebook({}, async (dir, store) => {
    const first = await ensureGeography(store, dir, found({}), TODAY)
    const relative = (file: string) => path.relative(path.join(dir, 'locations'), file)
    const city = await readFile(path.join(dir, 'locations/US/VT/Winooski.md'), 'utf8')
    assert({
      given: 'a US city in an empty notebook',
      should: 'save the country, the state and the city, outermost first, with Google details only on the city',
      actual: {
        ref: first.ref,
        created: first.created.map(relative),
        city: PlaceDocument.fromMarkdown(city).yaml,
        state: PlaceDocument.fromMarkdown(await readFile(path.join(dir, 'locations/US/VT.md'), 'utf8')).yaml,
      },
      expected: {
        ref: 'places/US/VT/Winooski',
        created: ['US.md', 'US/VT.md', 'US/VT/Winooski.md'],
        city: {
          name: 'Winooski',
          kind: 'city',
          ref: 'places/US/VT/Winooski',
          parent: 'places/US/VT',
          location: { country: 'US', region: 'VT', city: 'Winooski', latitude: 44.49, longitude: -73.19 },
          googleMapsUrl: 'https://maps.google.com/?cid=1',
          googlePlaceId: 'sample_city_id',
          created: TODAY,
          updated: TODAY,
        },
        state: {
          name: 'Vermont',
          kind: 'region',
          ref: 'places/US/VT',
          parent: 'places/US',
          location: { country: 'US', region: 'VT' },
          created: TODAY,
          updated: TODAY,
        },
      },
    })
    const again = await ensureGeography(store, dir, found({}), TODAY)
    const neighbor = await ensureGeography(
      store,
      dir,
      found({ name: 'Riverside Flats', kind: 'neighborhood', city: 'Winooski', googlePlaceId: 'sample_neighborhood' }),
      TODAY,
    )
    assert({
      given: 'the same city again, then a neighborhood in it',
      should: 'reuse every saved record and save only the neighborhood',
      actual: [again, { ...neighbor, created: neighbor.created.map(relative) }],
      expected: [
        { ref: 'places/US/VT/Winooski', created: [] },
        { ref: 'places/US/VT/Winooski/Riverside-Flats', created: ['US/VT/Winooski/Riverside-Flats.md'] },
      ],
    })
    const country = await ensureGeography(store, dir, found({ kind: 'country', name: 'France', country: 'FR' }), TODAY)
    const paris = await ensureGeography(
      store,
      dir,
      found({
        name: 'Paris',
        country: 'FR',
        region: { code: 'IDF', name: 'Île-de-France' },
        googlePlaceId: 'sample_paris',
      }),
      TODAY,
    )
    assert({
      given: 'a country, then a city in a country whose regions are not part of its places',
      should: 'save the city straight under its country',
      actual: [country.ref, paris.ref],
      expected: ['places/FR', 'places/FR/Paris'],
    })
  })
})

test('Google Maps names that match saved places reuse them; a namesake in another state does not', async () => {
  await notebook(
    {
      ...VERMONT,
      'US/NH.md':
        'name: New Hampshire\nkind: region\nref: places/US/NH\nparent: places/US\nlocation:\n  country: US\n  region: NH',
      // Saved by hand without its state
      'US/Montpelier.md': 'name: Montpelier\nkind: city\nref: places/US/Montpelier\nparent: places/US',
    },
    async (dir, store) => {
      const ensure = (input: Partial<FoundGeography>) => ensureGeography(store, dir, found(input), TODAY)
      assert({
        given: 'a saved city, a city saved without its state, and a namesake of a saved city in another state',
        should: 'reuse the first two and save the namesake inside its own state',
        actual: [
          await ensure({ name: 'Burlington' }),
          await ensure({ name: 'Montpelier' }),
          await ensure({ name: 'Burlington', region: { code: 'NH', name: 'New Hampshire' } }),
        ],
        expected: [
          { ref: 'places/US/VT/Burlington', created: [] },
          { ref: 'places/US/Montpelier', created: [] },
          { ref: 'places/US/NH/Burlington', created: [path.join(dir, 'locations/US/NH/Burlington.md')] },
        ],
      })
      store.set(path.join(dir, 'locations/US/VT/Sample-Town.md'), '---\nname: Sample Cafe Two\ntype: drink\n---\n')
      let error = ''
      try {
        await ensure({ name: 'Sample Town' })
      } catch (failure) {
        error = (failure as Error).message
      }
      assert({
        given: 'a city whose reference another record already holds',
        should: 'refuse and say which reference, leaving the other record alone',
        actual: error,
        expected:
          'places/US/VT/Sample-Town already belongs to another saved place. Open it in Places to check it, then try again.',
      })
    },
  )
})

test('a city typed by hand is saved inside the country or state chosen for it', async () => {
  await notebook(VERMONT, async (dir, store) => {
    const inCountry = await ensureCityIn(store, dir, 'Harbor City', 'places/FR', TODAY)
    const inState = await ensureCityIn(store, dir, 'Winooski', 'places/US/VT', TODAY)
    const existing = await ensureCityIn(store, dir, 'burlington', 'places/US/VT', TODAY)
    const relative = (file: string) => path.relative(path.join(dir, 'locations'), file)
    assert({
      given: 'a city in a country with no record, one in a saved state, and one already saved',
      should: 'save the country once, file each city inside its place, and reuse the saved city',
      actual: [
        { ...inCountry, created: inCountry.created.map(relative) },
        { ...inState, created: inState.created.map(relative) },
        existing,
        PlaceDocument.fromMarkdown(await readFile(path.join(dir, 'locations/US/VT/Winooski.md'), 'utf8')).location
          ?.region,
      ],
      expected: [
        { ref: 'places/FR/Harbor-City', created: ['FR.md', 'FR/Harbor-City.md'] },
        { ref: 'places/US/VT/Winooski', created: ['US/VT/Winooski.md'] },
        { ref: 'places/US/VT/Burlington', created: [] },
        'VT',
      ],
    })
    let error = ''
    try {
      await ensureCityIn(store, dir, 'Nowhere', 'places/US/VT/Burlington/drink/Sample-Cafe', TODAY)
    } catch (failure) {
      error = (failure as Error).message
    }
    assert({
      given: 'a venue chosen as the place a city is in',
      should: 'refuse with what to choose instead',
      actual: error,
      expected: 'Choose the country, region, or area this city is in.',
    })
  })
})
