import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { searchNotebook } from '../home/searchNotebook.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { backlinksOf, complete, resolveNames, vocabularyOf } from '../vocabulary/mod.ts'
import { createLinks } from './mod.ts'
import type { LinkSearch } from './types.ts'

const COUNTRY = 'places/locations/FR.md'
const CITY = 'places/locations/FR/Harbor-City.md'
const NOTE = 'time/2026/W05/01-27/day.md'
const CAFES = ['places/locations/FR/Harbor-City/drink/Cafe.md', 'places/locations/US/CA/Foam-City/drink/Cafe.md']

test('place search, stored references, legacy names, backlinks and AI traversal share identities', async () => {
  const base = await mkdtemp('/tmp/sky-place-links-')
  try {
    const files = {
      [COUNTRY]:
        '---\nname: France\nkind: country\nref: places/FR\nalt: [French Republic]\nsummary: Travel research\ncreated: 2026-01-27\nlocation:\n  country: FR\n---\n\n# France\n',
      [CITY]: '---\nname: Harbor City\nkind: city\nref: places/FR/Harbor-City\nparent: places/FR\n---\n',
      [NOTE]: '---\nlocation: places/FR\nrel: []\n---\n\n# Notes\n\nOriginal prose.\n',
      [CAFES[0]!]: '---\nname: Cafe\nalt: Harbor Cafe\ntype: drink\n---\n',
      [CAFES[1]!]: '---\nname: Cafe\ntype: drink\n---\n',
    }
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true })
      await writeFile(path.join(base, file), content)
    }
    const dirs = [path.join(base, 'places'), path.join(base, 'time')]
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [], placesDir: dirs[0], timeDirs: [dirs[1]!] })
    const app = createTestHttpApp(dirs, { markdownStore: store })
    const found = (await (await app.request('/docs/_api/links?kind=place&q=French')).json()) as LinkSearch
    const item = found.items[0]!
    const byContext = (await (
      await app.request('/docs/_api/links?kind=place&q=Travel&day=2026-01-27')
    ).json()) as LinkSearch
    assert({
      given: 'a saved place with summary and date metadata',
      should: 'retain contextual search and date filtering alongside country name lookup',
      actual: byContext.items.map((place) => place.value),
      expected: ['places/FR'],
    })
    assert({
      given: 'a country found by its alternate name',
      should: 'show its display name and save a resolvable places/ reference',
      actual: [item.title, item.value, item.path, store.resolve(item.value).type],
      expected: ['France', 'places/FR', COUNTRY, 'place'],
    })
    const cafes = (await (await app.request('/docs/_api/links?kind=place&q=Cafe')).json()) as LinkSearch
    assert({
      given: 'two saved places sharing a name',
      should: 'offer distinct references with geographic context and retain both in global search',
      actual: [
        new Set(cafes.items.map((i) => i.value)).size,
        cafes.items.every((i) => !!i.hint),
        searchNotebook(store, base, 'Cafe').length,
        store.resolve('Cafe').type,
      ],
      expected: [2, true, 2, 'unresolved'],
    })
    const vocabulary = await vocabularyOf(store, base)
    assert({
      given: 'place completion by name',
      should: 'use the same canonical reference as the link picker',
      actual: complete(vocabulary, { kind: 'places', query: 'France' })[0]?.value,
      expected: item.value,
    })
    const { host } = createLinks(store, base, dirs)
    await host.validate(['French Republic', item.value])
    await host.update(NOTE, [item.value], [])
    await host.update(NOTE, ['France'], [])
    const saved = await readFile(path.join(base, NOTE), 'utf8')
    assert({
      given: 'a country linked by canonical reference and then by its legacy display name',
      should: 'write it once and preserve the body',
      actual: saved,
      expected: files[NOTE]!.replace('rel: []', 'rel:\n  - places/FR'),
    })
    assert({
      given: 'location and parent references alongside rel',
      should: 'produce backlinks and make geography available to context traversal',
      actual: [
        backlinksOf(store, base, COUNTRY)
          .map((b) => b.path)
          .sort(),
        DomainCollection.fromDocument(store.findByPath(path.join(base, CITY))!.doc, path.join(base, CITY), store).has(
          path.join(base, COUNTRY),
        ),
      ],
      expected: [[CITY, NOTE].sort(), true],
    })
    assert({
      given: 'older name and file-shaped spellings',
      should: 'resolve to the country record',
      actual: await resolveNames(store, base, ['France', 'French Republic', 'places/locations/fr.md']),
      expected: Object.fromEntries(
        ['France', 'French Republic', 'places/locations/fr.md'].map((name) => [
          name,
          { type: 'place' as const, path: COUNTRY, label: 'France' },
        ]),
      ),
    })
    const resolved = (await (
      await app.request('/docs/_api/links/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: ['France', 'places/FR'] }),
      })
    ).json()) as LinkSearch
    assert({
      given: 'saved values using either generation of reference',
      should: 'display the same record',
      actual: resolved.items.map((i) => [i.title, i.path]),
      expected: [
        ['France', COUNTRY],
        ['France', COUNTRY],
      ],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('unsaved countries are searchable without writes and become records when explicitly selected', async () => {
  const base = await mkdtemp('/tmp/sky-place-selection-')
  try {
    const places = path.join(base, 'places')
    const time = path.join(base, 'time')
    await mkdir(path.dirname(path.join(base, NOTE)), { recursive: true })
    const original = '---\nrel: []\n---\n\nKeep the prose.\n'
    await writeFile(path.join(base, NOTE), original)
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [], placesDir: places, timeDirs: [time] })
    const app = createTestHttpApp([places, time], { markdownStore: store })
    const search = (await (await app.request('/docs/_api/links?q=France&kind=place')).json()) as LinkSearch
    const resolve = await app.request('/docs/_api/links/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: ['places/FR'] }),
    })
    assert({
      given: 'a country with no notebook file',
      should: 'offer one creation candidate while reads leave the notebook alone',
      actual: [search.items.map((item) => [item.value, item.needsCreation]), await readdir(base), await resolve.json()],
      expected: [[['places/FR', true]], ['time'], { items: [] }],
    })
    const choose = (value: string) =>
      app.request('/docs/_api/links/choose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    const picked = await choose('places/FR')
    const selected = (await picked.json()) as { item: { value: string; needsCreation?: boolean } }
    const { host } = createLinks(store, base, [places, time])
    await host.update(NOTE, [selected.item.value], [])
    const countryFile = path.join(base, COUNTRY)
    const annotated = (await readFile(countryFile, 'utf8')) + '\nKeep country notes.\n'
    await writeFile(countryFile, annotated)
    const repeated = await choose('places/FR')
    await host.validate(['places/CA'])
    const rejected = await choose('places/FR/Unknown-City')
    assert({
      given: 'selection, linking, repetition and an import selection',
      should: 'create resolvable targets once, update backlinks, preserve notes and reject unknown geography',
      actual: [
        picked.status,
        selected.item.value,
        selected.item.needsCreation,
        repeated.status,
        rejected.status,
        store.resolve('places/FR').type,
        store.resolve('places/CA').type,
        backlinksOf(store, base, COUNTRY).map((backlink) => backlink.path),
        await readFile(countryFile, 'utf8'),
        await readFile(path.join(base, NOTE), 'utf8'),
      ],
      expected: [
        200,
        'places/FR',
        undefined,
        200,
        400,
        'place',
        'place',
        [NOTE],
        annotated,
        original.replace('rel: []', 'rel:\n  - places/FR'),
      ],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('country selection rejects a destination linked outside the notebook', async () => {
  const base = await mkdtemp('/tmp/sky-country-boundary-')
  const outside = await mkdtemp('/tmp/sky-country-outside-')
  try {
    const places = path.join(base, 'places')
    const time = path.join(base, 'time')
    await mkdir(places)
    await mkdir(time)
    await symlink(outside, path.join(places, 'locations'))
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [], placesDir: places, timeDirs: [time] })
    const app = createTestHttpApp([places, time], { markdownStore: store })
    const response = await app.request('/docs/_api/links/choose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'places/FR' }),
    })
    assert({
      given: 'a country destination outside the notebook through a symlink',
      should: 'reject it before creating a record',
      actual: [response.status, await readdir(outside)],
      expected: [400, []],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
