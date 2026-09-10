import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { EntityIndex } from '#lib/notebook/enrich/resolve.ts'
import { createYogaInstance } from '#service/graphql/schema.ts'
import type { Store } from '#service/store.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import type { DocumentIO, DocumentSnapshot } from '#shared/models/Person/write.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { placeSourceFingerprint } from './backfill.ts'
import { applyPlaceBackfill, type PlaceBackfillReport } from './backfillApply.ts'
import { placeChoices } from './catalog.ts'

const SOURCE = '---\nsummary: A trip to France\nrel: [projects/Atlas]\n---\n\nFrance is the focus.\n'
const FILE = 'time/note.md'

async function fixture(
  run: (f: {
    root: string
    places: string
    store: PlaceStore
    index: EntityIndex
    io: DocumentIO
    states: Map<string, DocumentSnapshot>
    report: PlaceBackfillReport
    writes: string[]
  }) => Promise<void>,
) {
  const root = await realpath(await mkdtemp('/tmp/sky-backfill-test-'))
  const places = path.join(root, 'places')
  await mkdir(places)
  try {
    const store = await PlaceStore.build(places)
    const states = new Map<string, DocumentSnapshot>([[FILE, { path: FILE, content: SOURCE, version: 1 }]])
    const writes: string[] = []
    const io: DocumentIO = {
      read: async (file) => states.get(file) ?? null,
      save: async (file, content, version) => {
        const current = states.get(file)!
        if (current.version !== version) return { saved: false, current }
        states.set(file, { path: file, content, version: version + 1 })
        writes.push(file)
        return { saved: true }
      },
    }
    const index: EntityIndex = {
      candidates: [],
      canResolve: (ref) => !!store.findByPlacePath(ref),
      places: { store, choices: placeChoices(store) },
    }
    const report: PlaceBackfillReport = {
      format: 'sky-place-backfill-v1',
      notebook: root,
      created: '2026-01-02',
      since: '2026-01-01',
      sample: 'recent',
      records: 1,
      analyzed: 1,
      repair: { create: [], unresolved: [] },
      previews: [
        {
          path: FILE,
          fingerprint: placeSourceFingerprint(SOURCE),
          add: ['places/FR'],
          create: [{ ref: 'places/FR', name: 'France' }],
          evidence: [{ ref: 'places/FR', quote: 'France is the focus.' }],
          review: [],
        },
      ],
    }
    await run({ root, places, store, index, io, states, report, writes })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('backfill apply retains frontmatter, existing relationships and exact prose, then repeats without writing', async () => {
  await fixture(async ({ root, places, index, io, states, report, writes }) => {
    const source =
      '\uFEFF---\r\ntitle: "A quoted title" # keep\r\nlocation: places/CA\r\nrel: [projects/Atlas, "Jane Doe"]\r\n---\r\n\r\nFrance is the focus.\r\n\r\n<!-- Keep private notes -->\r\n[example]: https://example.com/\r\n'
    states.set(FILE, { path: FILE, content: source, version: 3 })
    report.previews[0]!.fingerprint = placeSourceFingerprint(source)
    const [first] = await applyPlaceBackfill(report, { notebook: root, index, io })
    const content = states.get(FILE)!.content
    const countryFile = path.join(places, 'locations/FR.md')
    const countryNotes = (await readFile(countryFile, 'utf8')) + '\nKeep these country notes.\n'
    await writeFile(countryFile, countryNotes)
    const [second] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'a reviewed proposal with existing links, comments and CRLF prose',
      should: 'add one resolvable country, keep the document content and make retries write-free',
      actual: [
        first?.status,
        first?.added,
        first?.created,
        second?.status,
        writes.length,
        [...Document.fromMarkdown(content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).rel],
        content.includes('title: "A quoted title" # keep\r\n'),
        content.includes('location: places/CA\r\n'),
        content.slice(content.indexOf('\r\n---\r\n') + 7) === source.slice(source.indexOf('\r\n---\r\n') + 7),
        await readFile(countryFile, 'utf8'),
      ],
      expected: [
        'applied',
        ['places/FR'],
        ['places/FR'],
        'unchanged',
        1,
        ['projects/Atlas', 'Jane Doe', 'places/FR'],
        true,
        true,
        true,
        countryNotes,
      ],
    })
  })
})

test('backfill skips edited or missing sources before creating their countries', async () => {
  await fixture(async ({ root, places, index, io, states, report, writes }) => {
    const changed = SOURCE + '\nA newer edit.\n'
    states.set(FILE, { path: FILE, content: changed, version: 2 })
    const [edited] = await applyPlaceBackfill(report, { notebook: root, index, io })
    states.delete(FILE)
    const [missing] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'a source edited or removed after preview',
      should: 'skip it without materializing targets or saving bytes',
      actual: [edited?.status, missing?.status, writes, await readdir(places)],
      expected: ['skipped', 'skipped', [], []],
    })
  })
})

test('backfill refuses a concurrent save and reports any country already materialized', async () => {
  await fixture(async ({ root, index, io, report, states, writes }) => {
    const changed = SOURCE + '\nAn edit made while applying.\n'
    const [result] = await applyPlaceBackfill(report, {
      notebook: root,
      index,
      io: {
        ...io,
        save: async () => {
          const current = { path: FILE, content: changed, version: 2 }
          states.set(FILE, current)
          return { saved: false, current }
        },
      },
    })
    assert({
      given: 'an edit winning the source version check after country creation',
      should: 'preserve the newer text, report the created target, and claim no added link',
      actual: [result?.status, result?.added, result?.created, states.get(FILE)?.content, writes],
      expected: ['skipped', [], ['places/FR'], changed, []],
    })
  })
})

test('removing reviewed rows or additions creates nothing for orphaned create entries', async () => {
  await fixture(async ({ root, places, index, io, report, writes }) => {
    report.previews[0]!.add = []
    const [removed] = await applyPlaceBackfill(report, { notebook: root, index, io })
    report.previews = []
    const empty = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'a rejected addition still carrying an informational creation entry, then an empty review',
      should: 'perform no changes',
      actual: [removed?.status, empty, writes, await readdir(places)],
      expected: ['unchanged', [], [], []],
    })
  })
})

test('backfill creates a missing country for an existing legacy rel without rewriting the source', async () => {
  await fixture(async ({ root, index, io, report, states, writes, store }) => {
    const source = SOURCE.replace('projects/Atlas', 'places/locations/fr.md')
    states.set(FILE, { path: FILE, content: source, version: 1 })
    report.previews[0]!.fingerprint = placeSourceFingerprint(source)
    report.previews[0]!.add = []
    const [result] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'a retained country creation already referenced by its legacy spelling',
      should: 'materialize the country and preserve the source bytes and spelling',
      actual: [
        result?.status,
        result?.added,
        result?.created,
        states.get(FILE)?.content,
        writes,
        store.findByPlacePath('places/FR')?.value.name,
      ],
      expected: ['applied', [], ['places/FR'], source, [], 'France'],
    })
  })
})

test('backfill never invents a missing city or ignores a reference conflict', async () => {
  await fixture(async ({ root, places, index, io, report, store, states, writes }) => {
    const ref = 'places/FR/Harbor-City'
    report.previews[0]!.add = [ref]
    report.previews[0]!.create = []
    const [missing] = await applyPlaceBackfill(report, { notebook: root, index, io })
    const record = `---\nname: Harbor City\nkind: city\nref: ${ref}\n---\n`
    for (const name of ['one.md', 'two.md']) {
      const file = path.join(places, name)
      await writeFile(file, record)
      store.set(file, record)
    }
    const [conflict] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'an unknown city, then two records claiming its identity',
      should: 'report failure without changing the source',
      actual: [missing?.status, conflict?.status, states.get(FILE)?.content, writes],
      expected: ['failed', 'failed', SOURCE, []],
    })
  })
})

test('backfill deduplicates saved aliases and does not create a country removed from the review', async () => {
  await fixture(async ({ root, places, store, index, io, report, states, writes }) => {
    report.previews[0]!.create = []
    const [removedCreation] = await applyPlaceBackfill(report, { notebook: root, index, io })
    const ref = 'places/FR/Harbor-City'
    const content = `---\nname: Harbor City\nkind: city\nref: ${ref}\nrefAliases: [places/FR/Old-Harbor]\n---\n`
    const file = path.join(places, 'city.md')
    await writeFile(file, content)
    store.set(file, content)
    index.places!.choices = placeChoices(store)
    const source = SOURCE.replace('projects/Atlas', 'places/FR/Old-Harbor')
    states.set(FILE, { path: FILE, content: source, version: 1 })
    report.previews[0]!.fingerprint = placeSourceFingerprint(source)
    report.previews[0]!.add = [ref]
    const [alias] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'an unapproved country creation and an already-linked city under an alias',
      should: 'decline the creation and retain the existing spelling without another link',
      actual: [removedCreation?.status, alias?.status, states.get(FILE)?.content, writes, await readdir(places)],
      expected: ['failed', 'unchanged', source, [], ['city.md']],
    })
  })
})

test('all report validation happens before the first mutation', async () => {
  await fixture(async ({ root, places, index, io, report, writes }) => {
    const badRows = [
      { ...report.previews[0], path: '../outside.md' },
      { ...report.previews[0], path: '/absolute.md' },
      { ...report.previews[0], path: 'time/other.md', fingerprint: undefined },
      { ...report.previews[0], path: 'time/other.md', add: ['people/Jane-Doe'] },
      { ...report.previews[0] },
    ]
    const rejected: boolean[] = []
    for (const bad of badRows) {
      try {
        await applyPlaceBackfill({ ...report, previews: [...report.previews, bad] }, { notebook: root, index, io })
        rejected.push(false)
      } catch {
        rejected.push(true)
      }
    }
    for (const bad of [
      { ...report, format: undefined },
      { ...report, notebook: path.dirname(root) },
    ]) {
      try {
        await applyPlaceBackfill(bad, { notebook: root, index, io })
        rejected.push(false)
      } catch {
        rejected.push(true)
      }
    }
    assert({
      given: 'a malformed, legacy, cross-notebook or duplicate report with a valid first row',
      should: 'reject the entire report before any source or country write',
      actual: [rejected, writes, await readdir(places)],
      expected: [[true, true, true, true, true, true, true], [], []],
    })
  })
})

test('backfill refuses source and country destinations that escape through symlinks', async () => {
  await fixture(async ({ root, places, index, io, report, writes }) => {
    const outside = await mkdtemp('/tmp/sky-backfill-outside-')
    try {
      await writeFile(path.join(outside, 'note.md'), SOURCE)
      await symlink(outside, path.join(root, 'time'))
      const [source] = await applyPlaceBackfill(report, { notebook: root, index, io })
      await rm(path.join(root, 'time'))
      await symlink(outside, path.join(places, 'locations'))
      const [country] = await applyPlaceBackfill(report, { notebook: root, index, io })
      await rm(path.join(places, 'locations'))
      await symlink(path.join(outside, 'missing'), path.join(places, 'locations'))
      const [dangling] = await applyPlaceBackfill(report, { notebook: root, index, io })
      assert({
        given: 'source and destination symlinks outside the notebook, including a dangling directory link',
        should: 'reject each without writing outside the notebook or changing the source',
        actual: [source?.status, country?.status, dangling?.status, writes, await readdir(outside)],
        expected: ['failed', 'failed', 'failed', [], ['note.md']],
      })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

test('backfill reports malformed YAML and analysis errors without creating countries', async () => {
  await fixture(async ({ root, places, index, io, report, states, writes }) => {
    const rejected: string[] = []
    for (const source of [
      '---\nrel: [broken\n---\nBody',
      '---\nrel: [projects/Atlas]\nBody',
      '---\nrel: { invalid: yes }\n---\nBody',
    ]) {
      states.set(FILE, { path: FILE, content: source, version: 1 })
      report.previews[0]!.fingerprint = placeSourceFingerprint(source)
      const [result] = await applyPlaceBackfill(report, { notebook: root, index, io })
      rejected.push(result!.status)
    }
    report.previews[0]!.error = 'Analysis unavailable.'
    const [failedAnalysis] = await applyPlaceBackfill(report, { notebook: root, index, io })
    assert({
      given: 'invalid or unclosed frontmatter, a non-list rel, or a failed preview',
      should: 'retain source bytes and avoid target creation',
      actual: [rejected, failedAnalysis?.status, writes, await readdir(places)],
      expected: [['failed', 'failed', 'failed'], 'skipped', [], []],
    })
  })
})

test('backfill applies through the GraphQL document API and preserves a concurrent disk edit', async () => {
  await fixture(async ({ root, places, index, report }) => {
    const time = path.join(root, 'time')
    const file = path.join(root, FILE)
    await mkdir(time)
    await writeFile(file, SOURCE)
    const yoga = createYogaInstance({} as Store, null, { baseDir: root, dirs: [time, places] })
    const query = async (text: string, variables: Record<string, unknown>) => {
      const response = await yoga.fetch(
        new Request('http://localhost/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: text, variables }),
        }),
      )
      const result = (await response.json()) as { data: Record<string, unknown>; errors?: Array<{ message: string }> }
      if (result.errors?.length) throw new Error(result.errors[0]!.message)
      return result.data
    }
    const io: DocumentIO = {
      read: async (path) =>
        (await query('query($path: String!) { documentContent(path: $path) { path content version } }', { path }))
          .documentContent as DocumentSnapshot | null,
      save: async (path, content, version) => {
        const result = (
          await query(
            'mutation($path: String!, $content: String!, $version: Float) { saveDocument(path: $path, content: $content, version: $version) { saved document { path content version } } }',
            { path, content, version },
          )
        ).saveDocument as { saved: boolean; document: DocumentSnapshot }
        return result.saved ? { saved: true } : { saved: false, current: result.document }
      },
    }
    const [first] = await applyPlaceBackfill(report, { notebook: root, io, index })
    const saved = await readFile(file, 'utf8')
    report.previews[0] = {
      path: FILE,
      fingerprint: placeSourceFingerprint(saved),
      add: ['places/CA'],
      create: [{ ref: 'places/CA', name: 'Canada' }],
      review: [],
    }
    const newer = saved + '\nA newer disk edit.\n'
    const [raced] = await applyPlaceBackfill(report, {
      notebook: root,
      index,
      io: {
        ...io,
        read: async (path) => {
          const snapshot = await io.read(path)
          await writeFile(file, newer)
          return snapshot
        },
      },
    })
    assert({
      given: 'the actual GraphQL read/save protocol followed by a conflicting disk edit',
      should: 'save the first relationship and refuse the second without overwriting the newer text',
      actual: [
        first?.status,
        [...Document.fromMarkdown(saved).rel],
        raced?.status,
        raced?.added,
        await readFile(file, 'utf8'),
      ],
      expected: ['applied', ['projects/Atlas', 'places/FR'], 'skipped', [], newer],
    })
  })
})
