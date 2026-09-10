import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { placeSourceFingerprint, previewPlaceBackfill } from '#lib/places/backfill.ts'
import { placeChoices } from '#lib/places/catalog.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { assert, test } from '#test'
import { autoRelMessage, proposeRel, type AutoRelServices } from './autoRel.ts'
import type { ExtractedSubjects } from './extract.ts'
import { groundedPlaces } from './extract.ts'
import { normalizeEntityName, type EntityIndex } from './resolve.ts'

const body = 'Compare France with Canada. France is the focus.'
const subjects: ExtractedSubjects = {
  people: [],
  orgs: [],
  projects: [],
  places: [
    { name: 'France', kind: 'country', context: [], quote: 'Compare France with Canada.' },
    { name: 'Canada', kind: 'country', context: [], quote: 'Compare France with Canada.' },
  ],
}

async function notebook(run: (dir: string, store: PlaceStore, services: AutoRelServices) => Promise<void>) {
  const dir = await mkdtemp('/tmp/sky-auto-place-')
  try {
    const store = await PlaceStore.build(dir)
    const buildIndex = async (): Promise<EntityIndex> => {
      const choices = placeChoices(store)
      return {
        candidates: choices.map((choice) => ({
          ref: choice.ref,
          norm: normalizeEntityName(choice.name),
          kind: 'place',
          label: choice.name,
        })),
        canResolve: (ref) => !!store.findByPlacePath(ref),
        places: { store, choices },
      }
    }
    await run(dir, store, {
      buildIndex,
      fetchScores: async () => undefined,
      loadCorpus: async () => ({ records: [] }),
      extract: async () => ({ subjects }),
      select: async () => ({ rel: ['places/FR'] }),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('automatic place links create only selected countries and a preview creates nothing', async () => {
  await notebook(async (dir, store, services) => {
    const proposal = await proposeRel({ body }, { mediums: ['note'] }, services)
    assert({
      given: 'two country subjects and one selected relationship',
      should: 'preview the link without materializing either country',
      actual: [proposal.rel, proposal.placeEvidence, await readdir(dir)],
      expected: [['places/FR'], [{ ref: 'places/FR', quote: 'Compare France with Canada.' }], []],
    })
    const rel = await autoRelMessage({ body }, { mediums: ['note'] }, services)
    assert({
      given: 'the selected relationship being prepared for a capture',
      should: 'make its target resolvable and leave the unselected country unsaved',
      actual: [
        rel,
        store.findByPlacePath('places/FR')?.value.name,
        store.findByPlacePath('places/CA'),
        await readdir(path.join(dir, 'locations')),
      ],
      expected: [['places/FR'], 'France', undefined, ['FR.md']],
    })
    const file = path.join(dir, 'locations/FR.md')
    const annotated = (await readFile(file, 'utf8')) + '\nKeep this note.\n'
    await writeFile(file, annotated)
    const repeated = await autoRelMessage(
      { body, existingRel: ['places/locations/fr.md'] },
      { mediums: ['note'] },
      services,
    )
    assert({
      given: 'an existing link with a legacy spelling and country notes',
      should: 'add no duplicate relationship and preserve the country bytes',
      actual: [repeated, await readFile(file, 'utf8')],
      expected: [undefined, annotated],
    })
  })
})

test('backfill uses the exact fetched source for its fingerprint, summary and existing links', async () => {
  await notebook(async (dir, _store, services) => {
    const source =
      '\uFEFF---\r\nsummary: France is the focus.\r\nlocation: places/CA\r\n---\r\n\r\nCompare France with Canada. France is the focus.\r\n<!-- hidden -->\r\n'
    const preview = await previewPlaceBackfill(
      {
        path: 'time/note.md',
        date: '2026-01-01',
        medium: 'note',
        tags: [],
        rel: ['places/FR'],
        summary: 'A stale indexed summary.',
        body: source,
      },
      {
        ...services,
        extract: async (req) => {
          assert({
            given: 'a CRLF/BOM source whose index still has an older summary and rel',
            should: 'extract only current prose and its summary',
            actual: [req.summary, req.body.includes('location:'), req.body.includes('hidden')],
            expected: ['France is the focus.', false, false],
          })
          return { subjects }
        },
      },
    )
    assert({
      given: 'a selected country missing from the actual source YAML',
      should: 'propose its link with evidence and fingerprint the original bytes without writing',
      actual: [preview.add, preview.evidence, preview.fingerprint, await readdir(dir)],
      expected: [
        ['places/FR'],
        [{ ref: 'places/FR', quote: 'Compare France with Canada.' }],
        placeSourceFingerprint(source),
        [],
      ],
    })
  })
})

test('automatic place links abstain on failed creation, inventions and unselected candidates', async () => {
  await notebook(async (dir, store, services) => {
    const declined = await autoRelMessage(
      { body },
      { mediums: ['chat'] },
      { ...services, select: async () => ({ rel: [] }) },
    )
    const invented = await autoRelMessage(
      { body },
      { mediums: ['chat'] },
      { ...services, select: async () => ({ rel: ['places/GB'] }) },
    )
    assert({
      given: 'an empty selection or a reference absent from the candidates',
      should: 'write neither a relationship nor a country file',
      actual: [declined, invented, await readdir(dir)],
      expected: [undefined, undefined, []],
    })
    const index = await services.buildIndex()
    await mkdir(path.join(dir, 'locations'))
    const file = path.join(dir, 'locations/FR.md')
    await writeFile(file, '# Existing notes\n')
    const failed = await autoRelMessage({ body }, { mediums: ['chat'] }, { ...services, buildIndex: async () => index })
    assert({
      given: 'a file appearing after candidate resolution that blocks country creation',
      should: 'preserve it and omit the unresolved link',
      actual: [failed, await readFile(file, 'utf8'), store.findByPlacePath('places/FR')],
      expected: [undefined, '# Existing notes\n', undefined],
    })
  })
})

test('place extraction requires quoted evidence for both the name and disambiguating context', () => {
  const req = { body: 'Cafe is the focus. France is mentioned separately.' }
  const mentions = [
    { name: 'Cafe', context: ['France'], quote: 'Cafe is the focus.' },
    { name: 'Canada', context: [], quote: 'France is mentioned separately.' },
    { name: 'France', context: [], quote: 'Invented discussion of France.' },
    { name: 'Cafe', context: [], quote: 'Cafe is the focus.' },
  ]
  assert({
    given: 'invented context, an invented name, an invented quote, and a grounded mention',
    should: 'retain only the grounded mention',
    actual: groundedPlaces(mentions, req),
    expected: [mentions[3]],
  })
})

test('a country in past relationship history alone never creates a new place link', async () => {
  await notebook(async (dir, _store, services) => {
    const rel = await autoRelMessage(
      { body: 'Discuss the release schedule.', to: 'Team channel' },
      { mediums: ['slack'] },
      {
        ...services,
        loadCorpus: async () => ({
          records: [
            {
              path: '/mock/message.md',
              date: '2026-01-01',
              medium: 'slack',
              to: 'Team channel',
              body: '',
              rel: ['places/FR'],
              tags: [],
            },
          ],
        }),
        extract: async () => ({ subjects: { people: [], orgs: [], projects: [], places: [] } }),
        select: async () => {
          throw new Error('No place candidate should reach selection.')
        },
      },
    )
    assert({
      given: 'prior country links without a place subject in this capture',
      should: 'abstain and leave the country unsaved',
      actual: [rel, await readdir(dir)],
      expected: [undefined, []],
    })
  })
})

test('an existing bare name that resolves to another entity does not suppress a new country link', async () => {
  await notebook(async (_dir, _store, services) => {
    const index = await services.buildIndex()
    const rel = await autoRelMessage(
      { body, existingRel: ['France'] },
      { mediums: ['note'] },
      {
        ...services,
        buildIndex: async () => ({ ...index, placeRef: (raw) => (raw === 'places/FR' ? raw : undefined) }),
      },
    )
    assert({
      given: 'a country name also used by a different entity already in rel',
      should: 'follow the store identity instead of deduplicating by the name alone',
      actual: rel,
      expected: ['places/FR'],
    })
  })
})

test('a selected venue deleted during judgment is not returned as a dangling link', async () => {
  await notebook(async (dir, store, services) => {
    const file = path.join(dir, 'Cafe.md')
    const content = '---\nname: Cafe\nref: places/FR/Harbor-City/Cafe\n---\n'
    await writeFile(file, content)
    store.set(file, content)
    const index = await services.buildIndex()
    const rel = await autoRelMessage(
      { body: 'Cafe is our topic.' },
      { mediums: ['note'] },
      {
        ...services,
        buildIndex: async () => index,
        extract: async () => ({
          subjects: {
            people: [],
            orgs: [],
            projects: [],
            places: [{ name: 'Cafe', kind: 'venue', quote: 'Cafe is our topic.' }],
          },
        }),
        select: async () => {
          await rm(file)
          return { rel: ['places/FR/Harbor-City/Cafe'] }
        },
      },
    )
    assert({
      given: 'an existing venue removed while the model selects its reference',
      should: 'omit the link and leave the venue uncreated',
      actual: [rel, await readdir(dir)],
      expected: [undefined, []],
    })
  })
})

test('backfill preserves existing aliases and reports ambiguous places for review without writes', async () => {
  await notebook(async (dir, store, services) => {
    store.set(path.join(dir, 'locations/FR/Harbor-City/Cafe.md'), '---\nname: Cafe\n---\n')
    store.set(path.join(dir, 'locations/US/Foam-City/Cafe.md'), '---\nname: Cafe\n---\n')
    const source = '---\nlocation: places/US\nrel: [places/locations/fr.md]\n---\n\nCafe and France are the topics.\n'
    const preview = await previewPlaceBackfill(
      {
        path: '/mock/time/2026/W05/01-27/note.md',
        date: '2026-01-27',
        medium: 'note',
        tags: [],
        rel: ['places/locations/fr.md'],
        body: source,
      },
      {
        ...services,
        extract: async (req) => {
          assert({
            given: 'a backfill source with physical location metadata',
            should: 'send only its prose to subject extraction',
            actual: req.body.trim(),
            expected: 'Cafe and France are the topics.',
          })
          return {
            subjects: {
              people: [],
              orgs: [],
              projects: [],
              places: [
                { name: 'Cafe', context: [], kind: 'venue', quote: 'Cafe and France are the topics.' },
                { name: 'France', context: [], kind: 'country', quote: 'Cafe and France are the topics.' },
              ],
            },
          }
        },
      },
    )
    assert({
      given: 'a missing target already linked by an old spelling and two plausible cafes',
      should: 'propose only the country creation and expose both cafe choices',
      actual: [
        preview.add,
        preview.create,
        preview.review.map((item) => [item.name, item.candidates.length]),
        await readdir(dir),
      ],
      expected: [[], [{ ref: 'places/FR', name: 'France' }], [['Cafe', 2]], []],
    })
  })
})
