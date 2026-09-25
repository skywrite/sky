import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { createPlacesStore } from './store.ts'
import { blankPlace, isWithinPlace, type PlacesOptions } from './types.ts'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-places-test-'))
  const dirs = ['places', 'people', 'orgs', 'library'].map((dir) => path.join(root, dir))
  await Promise.all(dirs.map((dir) => mkdir(dir)))
  const store = await MarkdownStore.build({
    placesDir: dirs[0],
    peopleDirs: [dirs[1]],
    orgDirs: [dirs[2]],
    libraryDir: dirs[3],
  })
  const options: PlacesOptions = {
    placesDir: dirs[0],
    stateDir: path.join(root, '.state'),
    now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
  }
  const places = createPlacesStore(store, root, dirs, options)
  return {
    root,
    store,
    places,
    options,
    app: createTestHttpApp(dirs, { markdownStore: store, places: options }),
    seed: async (file: string, contents: string) => {
      const target = path.join(root, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
      store.set(target, contents)
    },
    close: () => rm(root, { recursive: true, force: true }),
  }
}
const failure = async (work: Promise<unknown>) => {
  try {
    await work
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

test('Places preserve legacy references, YAML comments and prose through metadata edits, rename and file moves', async () => {
  const f = await fixture()
  try {
    const original =
      '---\n# Keep this comment\nname: Joe’s Cafe\ntype: drink\ncustom: { nested: preserve me }\nlocation:\n  country: FR\n  latitude: 48.85837\n  longitude: 2.294481\n  plusCode: sample\n---\n\n# Joe’s Cafe\n\nAn original paragraph.\n\n## Notes\n\nKeep every line.\n'
    const id = 'places/locations/FR/Paris/drink/Joes-Cafe.md'
    await f.seed(id, original)
    const before = await f.places.detail(id)
    const after = await f.places.save({ ...before, name: 'Joe’s Coffee', address: '12 Example Street' })
    const raw = await readFile(path.join(f.root, id), 'utf8')
    assert({
      given: 'a name and address edit to a legacy venue',
      should: 'preserve its identity, aliases, metadata and exact prose',
      actual: [
        after.id,
        after.ref,
        after.aliases,
        raw.includes('# Keep this comment'),
        raw.includes('nested: preserve me'),
        raw.includes('plusCode: sample'),
        raw.endsWith(original.split('---\n').at(-1)!),
      ],
      expected: [id, 'places/FR/Paris/drink/Joes-Cafe', ['Joe’s Cafe'], true, true, true, true],
    })
    const moved = path.join(f.root, 'places/locations/Moved.md')
    await rename(path.join(f.root, id), moved)
    f.store.delete(path.join(f.root, id))
    f.store.set(moved, raw)
    assert({
      given: 'the edited file is moved externally',
      should: 'still resolve its original reference',
      actual: f.places.resolveRef(after.ref),
      expected: 'places/locations/Moved.md',
    })
  } finally {
    await f.close()
  }
})

test('Places create readable names atomically, distinguish namesakes and reject stale edits or duplicate Google identities', async () => {
  const f = await fixture()
  try {
    const input = { ...blankPlace(), name: 'Garden House', googlePlaceId: 'sample_google_place' }
    const concurrent = await Promise.allSettled([f.places.save(input), f.places.save(input)])
    const saved = f.places.index()[0]
    const namesake = await f.places.save({ ...blankPlace(), name: 'Garden House', allowNamesake: true })
    assert({
      given: 'simultaneous duplicate imports and a confirmed namesake',
      should: 'publish once per identity and suffix colliding readable filenames',
      actual: [concurrent.map((r) => r.status).sort(), saved.id, namesake.id, f.store.places.size],
      expected: [
        ['fulfilled', 'rejected'],
        'places/locations/2026/2026-02-12_093400_Garden-House.md',
        'places/locations/2026/2026-02-12_093400_Garden-House-2.md',
        2,
      ],
    })
    const before = await f.places.detail(saved.id)
    const raw = await readFile(path.join(f.root, saved.id), 'utf8')
    await writeFile(path.join(f.root, saved.id), raw + '\nAn external change.\n')
    const result = await failure(f.places.save({ ...before, address: 'Changed address' }))
    assert({
      given: 'the watcher has not yet seen an external edit',
      should: 'reject a stale save while retaining the external change',
      actual: [
        result.includes('changed'),
        (await readFile(path.join(f.root, saved.id), 'utf8')).endsWith('An external change.\n'),
      ],
      expected: [true, true],
    })
    const current = await f.places.detail(saved.id)
    const note = await f.places.addNote(current.id, current.revision, 'A new memory.')
    const archived = await f.places.archive(note.id, note.revision, true)
    const restored = await f.places.archive(archived.id, archived.revision, false)
    assert({
      given: 'a note, archive and restore',
      should: 'keep the notebook file and its resolvable identity',
      actual: [
        note.html.includes('A new memory.'),
        archived.archived,
        restored.archived,
        f.places.resolveRef(saved.ref),
      ],
      expected: [true, true, false, saved.id],
    })
  } finally {
    await f.close()
  }
})

test('Clearing a legacy location or Maps URL preserves unrelated metadata without reviving fallback values', async () => {
  const f = await fixture()
  try {
    const id = 'places/locations/Legacy.md'
    await f.seed(
      id,
      '---\nname: Sample Cafe\nlocation: { latitude: 48.85837, longitude: 2.294481 }\naddressComponents: { country: FR, state: Example Region, city: Paris, postal: sample }\nGoogleMaps: { url: "https://www.google.com/maps/search/?api=1&query=sample", custom: keep }\n---\nNotes stay here.\n',
    )
    const before = await f.places.detail(id)
    const after = await f.places.save({ ...before, region: '', city: '', googleMapsUrl: '' })
    const raw = await readFile(path.join(f.root, id), 'utf8')
    assert({
      given: 'explicitly cleared fields in a legacy document',
      should: 'clear fallback fields while retaining unrelated address and Maps metadata',
      actual: [
        after.region,
        after.city,
        after.googleMapsUrl,
        raw.includes('postal: sample'),
        raw.includes('custom: keep'),
      ],
      expected: ['', '', '', true, true],
    })
  } finally {
    await f.close()
  }
})

test('Geographic parent relationships work without coordinates and cannot form cycles', async () => {
  const f = await fixture()
  try {
    const country = await f.places.save({ ...blankPlace(), name: 'France', kind: 'country' })
    const city = await f.places.save({ ...blankPlace(), name: 'Harbor City', kind: 'city', parent: country.ref })
    const venue = await f.places.save({ ...blankPlace(), name: 'Atlas Studio', kind: 'venue', parent: city.ref })
    const detail = await f.places.detail(country.id)
    const cycle = await failure(f.places.save({ ...city, parent: city.ref }))
    const descendant = await failure(f.places.save({ ...country, kind: 'region', parent: city.ref }))
    const venueParent = await failure(
      f.places.save({ ...blankPlace(), name: 'Invalid child', kind: 'city', parent: venue.ref }),
    )
    assert({
      given: 'a country, city and venue without map locations',
      should: 'preserve natural country identity, list descendants, and reject cycles or venue parents',
      actual: [
        country.ref,
        detail.children.map((p) => p.name).sort(),
        venue.ancestors.map((p) => p.name),
        cycle.includes('descendants'),
        descendant.includes('descendants'),
        venueParent.includes('existing'),
        isWithinPlace(venue, country.ref, f.places.index()),
      ],
      expected: ['places/FR', ['Atlas Studio', 'Harbor City'], ['France', 'Harbor City'], true, true, true, true],
    })
    await f.seed('places/locations/FR/Paris/Cafe.md', '---\nname: Legacy Cafe\n---\n')
    assert({
      given: 'a legacy venue beneath a saved country ref',
      should: 'include its existing geographic ancestry without creating records on read',
      actual: [f.places.index().find((p) => p.name === 'Legacy Cafe')?.parentRef, f.store.places.size],
      expected: ['places/FR', 4],
    })
  } finally {
    await f.close()
  }
})

test('Places show real notebook connections and safe rendered notes', async () => {
  const f = await fixture()
  try {
    const place = await f.places.save({
      ...blankPlace(),
      name: 'Garden House',
      notes: 'A first paragraph.\n\nA second paragraph.\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))',
    })
    await f.seed('people/Jane.md', `---\nname: Jane Doe\nlocation: ${place.ref}\n---\n`)
    await f.seed('orgs/Atlas.md', '---\nname: Atlas\n---\n')
    await f.seed(
      'library/Workshop.md',
      `---\ntitle: Planning workshop\nrel: [Atlas]\nwho: Jane Doe\nwhere: ${place.ref}\n---\n`,
    )
    const detail = await f.places.detail(place.id)
    assert({
      given: 'a person located here and a workshop held here with an organization',
      should: 'show both relationship context and safe notes',
      actual: [
        detail.activity.map((a) => [a.label, a.via]).sort(),
        detail.people.map((p) => p.name).sort(),
        detail.html.includes('<script'),
        detail.html.includes('javascript:'),
      ],
      expected: [
        [
          ['Jane Doe', 'location'],
          ['Planning workshop', 'where'],
        ],
        ['Atlas', 'Jane Doe'],
        false,
        false,
      ],
    })
  } finally {
    await f.close()
  }
})

test('Places HTTP validates writes, origins and notebook boundaries', async () => {
  const f = await fixture()
  try {
    const send = (body: unknown, headers = {}) =>
      f.app.request('/places/_api/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    const input = { ...blankPlace(), name: 'Sample Place' }
    const cross = await send(input, { Origin: 'https://example.com' })
    const invalid = await send({ ...input, coordinates: { latitude: 91, longitude: 0 } })
    const script = await send({ ...input, site: 'javascript:alert(1)' })
    const outside = await f.app.request('/places/_api/place?id=../elsewhere.md')
    const page = await f.app.request('/places/FR')
    const noHost = await f.app.request('/places/_api/google/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Cafe' }),
    })
    assert({
      given: 'invalid coordinates, unsafe links, cross-origin writes and out-of-scope paths',
      should: 'reject them without creating content while serving the page and manual setup',
      actual: [
        cross.status,
        invalid.status,
        script.status,
        outside.status,
        page.status,
        noHost.status,
        f.store.places.size,
      ],
      expected: [403, 400, 400, 404, 200, 503, 0],
    })
    await f.seed('places/locations/Link.md', '---\nname: Linked file\n---\n')
    const file = path.join(f.root, 'places/locations/Link.md'),
      target = path.join(f.root, 'outside.md')
    await writeFile(target, '---\nname: Outside\n---\n')
    await rm(file)
    await symlink(target, file)
    assert({
      given: 'an indexed place file swapped for a symlink',
      should: 'refuse to read or edit through it',
      actual: (await failure(f.places.detail('places/locations/Link.md'))).includes('regular notebook'),
      expected: true,
    })
  } finally {
    await f.close()
  }
})
