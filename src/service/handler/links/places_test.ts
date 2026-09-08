import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
        '---\nname: France\nkind: country\nref: places/FR\nalt: [French Republic]\nlocation:\n  country: FR\n---\n\n# France\n',
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
