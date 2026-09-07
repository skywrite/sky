import { buildSchema, parse, validate } from 'graphql'
import { typeDefs } from '#service/graphql/schema.ts'
import { assert, test } from '#test'
import { loadVoiceEntities, type VoiceEntityFetcher } from './contextEntities.ts'

function responses(payloads: unknown[], queries: string[] = []): VoiceEntityFetcher {
  let index = 0
  return async (_input, init) => {
    queries.push(JSON.parse(String(init.body)).query)
    return Response.json(payloads[index++])
  }
}

const PROJECT = { path: 'projects/open/Atlas/project.md', name: 'Atlas', status: 'open' }
const DECISION = {
  path: 'decisions/hosting.md',
  name: 'hosting',
  summary: 'Choose a provider.',
  identified: '2026-01-25',
  target: '2026-01-30',
}
const JANE = {
  name: 'Jane Doe',
  names: ['Jane Doe', 'J. Doe'],
  title: 'Designer',
  org: 'Example Studio',
  path: 'people/Jane-Doe.md',
}

test('voice entities preserve source records and resolve ranked aliases without duplicate profiles', async () => {
  const queries: string[] = []
  const unknownName = 'Alex "AJ" Example'
  const entities = await loadVoiceEntities(
    4321,
    responses(
      [
        {
          data: {
            projects: [PROJECT],
            decisions: [DECISION],
            peopleWithScores: [{ name: 'Jane Doe' }, { name: 'J. Doe' }, { name: unknownName }],
          },
        },
        { data: { p0: JANE, p1: JANE, p2: null } },
      ],
      queries,
    ),
  )
  assert({
    given: 'a canonical person, their ranked alias, and a name with no contact record',
    should: 'keep one profile with aliases and label the unresolved name by its real source',
    actual: entities.people,
    expected: [
      { source: JANE.path, body: 'Jane Doe\nAliases: J. Doe\nTitle: Designer\nOrganization: Example Studio' },
      { source: 'interaction ranking', body: unknownName },
    ],
  })
  assert({
    given: 'project and decision evidence',
    should: 'preserve compact metadata, source paths, and the meaning of recorded dates',
    actual: [entities.projects, entities.decisions, entities.unavailable],
    expected: [
      [{ source: PROJECT.path, body: 'Atlas\nStatus: open' }],
      [
        {
          source: DECISION.path,
          body: 'hosting\nSummary: Choose a provider.\nIdentified: 2026-01-25\nTarget: 2026-01-30',
        },
      ],
      [],
    ],
  })
  assert({
    given: 'the production service schema and names containing quotes',
    should: 'produce valid, safely encoded GraphQL queries',
    actual: queries.flatMap((query) => validate(buildSchema(typeDefs), parse(query)).map((error) => error.message)),
    expected: [],
  })
})

test('voice entities retain project and decision context when profile lookup fails', async () => {
  const entities = await loadVoiceEntities(
    4321,
    responses([
      { data: { projects: [PROJECT], decisions: [DECISION], peopleWithScores: [{ name: 'Jane Doe' }] } },
      { errors: [{ message: 'Unavailable' }] },
    ]),
  )
  assert({
    given: 'a successful index query and a failed person detail query',
    should: 'keep successful context and make the profile limitation explicit',
    actual: [entities.projects.length, entities.decisions.length, entities.people, entities.unavailable],
    expected: [
      1,
      1,
      [{ source: 'interaction ranking', body: 'Jane Doe' }],
      ['Ranked people profiles were unavailable; names are from interaction ranking only.'],
    ],
  })
})

test('voice entities separate partial service errors from valid empty selections', async () => {
  const partial = await loadVoiceEntities(
    4321,
    responses([
      {
        data: { projects: [PROJECT, { path: 'invalid' }], decisions: null, peopleWithScores: [] },
        errors: [{ message: 'Resolver failed' }],
      },
    ]),
  )
  const emptyQueries: string[] = []
  const empty = await loadVoiceEntities(
    4321,
    responses(
      [
        {
          data: { projects: [], decisions: [], peopleWithScores: [] },
        },
      ],
      emptyQueries,
    ),
  )
  assert({
    given: 'partially usable GraphQL data and invalid document entries',
    should: 'preserve valid evidence and report missing coverage',
    actual: [partial.projects.length, partial.unavailable],
    expected: [
      1,
      [
        'The notebook service reported errors; returned context may be incomplete.',
        'Some projects could not be loaded.',
        'Pending decisions were unavailable.',
      ],
    ],
  })
  assert({
    given: 'valid empty selections',
    should: 'avoid an unnecessary profile request and keep selection limits distinct from failures',
    actual: [emptyQueries.length, empty.unavailable, empty.notes.length],
    expected: [1, [], 3],
  })
})

test('voice entities enforce selection limits even if the service returns oversized lists', async () => {
  const queries: string[] = []
  const profiles = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, null]))
  const entities = await loadVoiceEntities(
    4321,
    responses(
      [
        {
          data: {
            projects: Array.from({ length: 25 }, () => PROJECT),
            decisions: Array.from({ length: 15 }, () => DECISION),
            peopleWithScores: Array.from({ length: 35 }, (_, i) => ({ name: `Example Person ${i}` })),
          },
        },
        { data: profiles },
      ],
      queries,
    ),
  )
  assert({
    given: 'more records than the startup allowance',
    should: 'bound every category and issue exactly two requests',
    actual: [entities.projects.length, entities.decisions.length, entities.people.length, queries.length],
    expected: [20, 12, 30, 2],
  })
})

test('voice entities report HTTP and malformed response failures without throwing', async () => {
  const fetchers: VoiceEntityFetcher[] = [
    async () => new Response('Unavailable', { status: 503 }),
    responses([{ data: null, errors: [{ message: 'Failure' }] }]),
    responses([{ data: [] }]),
    async () => new Response('invalid json'),
  ]
  const results = await Promise.all(fetchers.map((fetcher) => loadVoiceEntities(4321, fetcher)))
  assert({
    given: 'HTTP, GraphQL, shape, or JSON failures',
    should: 'report unavailable context instead of implying an empty notebook',
    actual: results.map((result) => result.unavailable),
    expected: fetchers.map(() => [
      'People, open projects, and pending decisions were unavailable from the notebook service.',
    ]),
  })
})

test('voice entities cancel a stalled service request', async () => {
  let signal: AbortSignal | null | undefined
  const fetcher: VoiceEntityFetcher = (_input, init) => {
    signal = init.signal
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
    })
  }
  const result = await loadVoiceEntities(4321, fetcher)
  assert({
    given: 'a service that never responds',
    should: 'abort its request and return an explicit context failure',
    actual: [signal?.aborted, result.unavailable.length],
    expected: [true, 1],
  })
})
