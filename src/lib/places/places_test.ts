import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import PlaceDocument, { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { countryPlace, ensurePlaceRecord } from './geography.ts'
import { planPlaceRepair } from './repair.ts'

async function notebook(run: (dir: string, store: PlaceStore) => Promise<void>) {
  const dir = await mkdtemp('/tmp/sky-places-')
  try {
    await run(dir, await PlaceStore.build(dir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('geographic records keep their identity without coordinates and normalize old file references', () => {
  const country = countryPlace('places/locations/fr.md')!
  const city = PlaceDocument.createGeographic({
    name: 'Harbor City',
    ref: 'places/FR/Harbor-City',
    kind: 'city',
    parent: country.ref,
    aliases: ['Port City'],
  })
  const parsed = PlaceDocument.fromMarkdown(city.toMarkdown())
  assert({
    given: 'a country and a named city with no Maps data',
    should: 'round-trip their kind, reference, parent and aliases without inventing coordinates',
    actual: [
      country.name,
      country.kind,
      country.location,
      country.toFilePath(),
      parsed.toPath(),
      parsed.parent,
      parsed.aliases,
      parsed.location,
    ],
    expected: [
      'France',
      'country',
      {
        country: 'FR',
        region: undefined,
        city: undefined,
        subcity: undefined,
        latitude: undefined,
        longitude: undefined,
        plusCode: undefined,
      },
      'FR',
      'places/FR/Harbor-City',
      'places/FR',
      ['Port City'],
      undefined,
    ],
  })
  assert({
    given: 'unknown, deprecated and macroregion codes, or a city ref',
    should: 'abstain from automatically creating a country',
    actual: ['places/ZZ', 'places/AN', 'places/EU', 'places/FR/Harbor-City'].map(countryPlace),
    expected: [undefined, undefined, undefined, undefined],
  })
  assert({
    given: 'references containing traversal or an empty segment',
    should: 'reject them before they can become paths',
    actual: ['places/../escape', 'places/FR/../../escape', 'places//FR'].map(normalizePlaceRef),
    expected: [undefined, undefined, undefined],
  })
})

test('place identities survive moves, duplicate names, alias edits and deletion', async () => {
  await notebook(async (dir, store) => {
    const first = path.join(dir, 'locations/FR/Harbor-City/drink/Cafe.md')
    const second = path.join(dir, 'locations/US/CA/Foam-City/drink/Cafe.md')
    const content =
      '---\nname: Cafe\nalt: Harbor Cafe\nref: places/FR/Harbor-City/Cafe\nrefAliases: [places/FR/Old-Cafe]\n---\n\nKeep these notes.\n'
    store.set(first, content)
    store.set(second, '---\nname: Cafe\n---\n')
    assert({
      given: 'two places with one display name and a unique alias',
      should: 'retain both records, abstain on the ambiguous name and resolve canonical and former refs',
      actual: [
        store.size,
        store.find('Cafe'),
        store.find('harbor cafe')?.path,
        store.findByPlacePath('places/fr/old-cafe.md')?.path,
      ],
      expected: [2, undefined, first, first],
    })
    const moved = path.join(dir, 'locations/FR/Harbor-City/visit/Renamed-Cafe.md')
    store.delete(first)
    store.set(moved, content.replace('name: Cafe', 'name: Renamed Cafe').replace('Harbor Cafe', 'Waterside Cafe'))
    assert({
      given: 'a file moved and renamed while keeping its explicit ref',
      should: 'retain the identity, drop removed aliases and restore a formerly ambiguous name',
      actual: [
        store.findByPlacePath('places/FR/Harbor-City/Cafe')?.path,
        store.findByPlacePath('places/FR/Old-Cafe')?.path,
        store.find('Harbor Cafe'),
        store.find('Waterside Cafe')?.path,
        store.find('Cafe')?.path,
      ],
      expected: [moved, moved, undefined, moved, second],
    })
    store.set(first, content)
    assert({
      given: 'two files claiming the same canonical ref',
      should: 'leave it unresolved instead of depending on scan order',
      actual: store.findByPlacePath('places/FR/Harbor-City/Cafe'),
      expected: undefined,
    })
    store.delete(first)
    assert({
      given: 'the conflicting record removed',
      should: 'restore resolution to the remaining record',
      actual: store.findByPlacePath('places/FR/Harbor-City/Cafe')?.path,
      expected: moved,
    })
  })
})

test('repair previews missing countries, creates them once, and preserves records on repeat', async () => {
  await notebook(async (dir, store) => {
    const source = '---\nrel: [places/FR, places/FR/Harbor-City]\nlocation: places/FR\n---\n\nOriginal conversation.\n'
    const docs = [Document.fromMarkdown(source)]
    const plan = planPlaceRepair(docs, store)
    assert({
      given: 'a missing country and a city needing confirmation',
      should: 'propose only the recognized country without writing anything',
      actual: [plan.create, plan.unresolved.map((i) => [i.ref, i.uses]), store.size],
      expected: [[{ ref: 'places/FR', name: 'France' }], [['places/FR/Harbor-City', 1]], 0],
    })
    const result = await ensurePlaceRecord(store, dir, countryPlace(plan.create[0]!.ref)!)
    const annotated = (await readFile(result.filePath, 'utf8')) + '\nA personal note to preserve.\n'
    await writeFile(result.filePath, annotated)
    const rebuilt = await PlaceStore.build(dir)
    const repeat = await ensurePlaceRecord(rebuilt, dir, countryPlace('places/FR')!)
    assert({
      given: 'the repair repeated after adding notes to the country record',
      should: 'reuse the same record, leave its bytes intact and require no further country repair',
      actual: [
        result.created,
        repeat.created,
        repeat.filePath,
        await readFile(result.filePath, 'utf8'),
        planPlaceRepair(docs, rebuilt).create,
        docs[0]!.markdown,
      ],
      expected: [true, false, result.filePath, annotated, [], Document.fromMarkdown(source).markdown],
    })
    const city = PlaceDocument.createGeographic({
      name: 'Harbor City',
      ref: 'places/FR/Harbor-City',
      kind: 'city',
      parent: 'places/FR',
    })
    await ensurePlaceRecord(rebuilt, dir, city)
    assert({
      given: 'the missing city created explicitly',
      should: 'resolve the remaining reference beside the country file',
      actual: planPlaceRepair(docs, rebuilt),
      expected: { create: [], unresolved: [] },
    })
  })
})

test('creation preserves an unindexed existing file and rejects symlink destinations outside places', async () => {
  await notebook(async (dir, store) => {
    const root = path.join(dir, 'locations')
    await mkdir(root)
    const existing = path.join(root, 'FR.md')
    await writeFile(existing, '# Hand-written country notes\n')
    const message = await ensurePlaceRecord(store, dir, countryPlace('places/FR')!).then(
      () => '',
      (error: Error) => error.message,
    )
    assert({
      given: 'an existing file without a name in frontmatter',
      should: 'report the conflict and preserve its bytes',
      actual: [message.includes('preserved'), await readFile(existing, 'utf8')],
      expected: [true, '# Hand-written country notes\n'],
    })
    const outside = path.join(dir, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(root, 'FR'))
    const city = PlaceDocument.createGeographic({ name: 'Harbor City', ref: 'places/FR/Harbor-City', kind: 'city' })
    const failure = await ensurePlaceRecord(store, dir, city).then(
      () => '',
      (error: Error) => error.message,
    )
    assert({
      given: 'a country directory linked outside the locations root',
      should: 'reject the write',
      actual: failure,
      expected: 'Place destination is outside the locations directory.',
    })
  })
})
