import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { FIXTURES_DIR } from '../../fixtures/mod.ts'
import { ScoringStore } from '../../scoring/ScoringStore.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { ago, backlinksOf, complete, matchScore, resolveNames, scoresFrom, vocabularyOf } from './mod.ts'

const storePromise = MarkdownStore.build({
  peopleDirs: [`${FIXTURES_DIR}/people`],
  orgDirs: [`${FIXTURES_DIR}/orgs`],
  projectsDir: `${FIXTURES_DIR}/projects`,
  timeDirs: [`${FIXTURES_DIR}/time`],
})

test({ name: 'vocabulary - a match ranks by how the query sits in the candidate' }, () => {
  assert({
    given:
      'the query "ac" against an exact name, a prefix, a word prefix, a substring, scattered letters, and no match',
    should: 'score 0, 1, 2, 3, 4 and null',
    actual: ['ac', 'Acme Corp', 'Big Acme', 'pacman', 'a plus c', 'xyz'].map((candidate) =>
      matchScore('ac', candidate),
    ),
    expected: [0, 1, 2, 3, 4, null],
  })
})

test({ name: 'vocabulary - people, linked documents, keys, values and tags complete from the store' }, async () => {
  const store = await storePromise
  const vocabulary = vocabularyOf(store, FIXTURES_DIR)
  assert({
    given: 'a person, an org and a day document by a few letters of their names',
    should: 'come back typed, with their paths and a hint',
    actual: [
      complete(vocabulary, { kind: 'people', query: 'ale' })[0],
      complete(vocabulary, { kind: 'rel', query: 'acme' })[0],
      complete(vocabulary, { kind: 'rel', query: 'weekly sync' })[0],
    ],
    expected: [
      {
        value: 'Alex Rivera',
        type: 'person',
        path: 'people/Alex-Rivera.md',
        hint: 'Platform Partnerships Manager · Meta',
      },
      { value: 'Acme Corp', type: 'org', path: 'orgs/Acme-Corp.md', hint: 'technology' },
      {
        value: 'time/2026/W04/01-20/meeting_Chen-Wei_Weekly-Sync',
        type: 'day',
        path: 'time/2026/W04/01-20/meeting_Chen-Wei_Weekly-Sync.md',
        hint: 'time/2026/W04/01-20',
      },
    ],
  })
  assert({
    given:
      'the keys of the time directory starting with "me", the values of medium there, and tags matching "work/eng"',
    should: 'name the key, include the value in use, and the tag with its count',
    actual: [
      complete(vocabulary, { kind: 'keys', dir: 'time', query: 'me' }).map((item) => item.value),
      complete(vocabulary, { kind: 'values', dir: 'time', key: 'medium', query: '' }).some(
        (item) => item.value === 'Zoom' && item.type === 'value' && (item.count ?? 0) >= 1,
      ),
      complete(vocabulary, { kind: 'tags', query: 'work/eng' }).map((item) => [
        item.value,
        item.type,
        (item.count ?? 0) >= 1,
      ]),
    ],
    expected: [
      ['medium'],
      true,
      [
        ['Work/Engineering', 'tag', true],
        ['Person/Work/Engineering', 'tag', true],
      ],
    ],
  })
  assert({
    given: 'names as a document writes them, one unknown',
    should: 'resolve each to its type and path, or null',
    actual: resolveNames(store, FIXTURES_DIR, ['Alex Rivera', 'Acme Corp', 'Nobody Here']),
    expected: {
      'Alex Rivera': { type: 'person', path: 'people/Alex-Rivera.md' },
      'Acme Corp': { type: 'org', path: 'orgs/Acme-Corp.md' },
      'Nobody Here': null,
    },
  })
})

test({ name: 'vocabulary - the routes answer the panel' }, async () => {
  const store = await storePromise
  const app = createTestHttpApp([`${FIXTURES_DIR}/people`], { markdownStore: store })
  const completion = await app.request('http://localhost/docs/_api/complete?kind=people&q=ale&limit=1')
  const resolved = await app.request('http://localhost/docs/_api/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names: ['Acme Corp'] }),
  })
  const unknownKind = await app.request('http://localhost/docs/_api/complete?kind=planets&q=x')
  assert({
    given: 'a completion request, a resolve request, and an unknown kind',
    should: 'answer with items, with the resolved map, and with 400',
    actual: [
      ((await completion.json()) as { items: { value: string }[] }).items.map((item) => item.value),
      (await resolved.json()) as unknown,
      unknownKind.status,
    ],
    expected: [['Alex Rivera'], { resolved: { 'Acme Corp': { type: 'org', path: 'orgs/Acme-Corp.md' } } }, 400],
  })
})

test({ name: 'vocabulary - linked from: the documents that name a person or an org, newest first' }, async () => {
  const store = await storePromise
  const person = backlinksOf(store, FIXTURES_DIR, 'people/Chen-Wei.md')
  const org = backlinksOf(store, FIXTURES_DIR, 'orgs/Acme-Corp.md')
  assert({
    given: 'a person named in a meeting capture, and an org in its rel',
    should: 'list the capture under both, typed as a day document with its date and the key it came through',
    actual: [
      person.some(
        (item) =>
          item.path === 'time/2026/W04/01-20/meeting_Chen-Wei_Weekly-Sync.md' &&
          item.type === 'day' &&
          item.date === '2026-01-20' &&
          item.via === 'who',
      ),
      org.some((item) => item.path === 'time/2026/W04/01-20/meeting_Chen-Wei_Weekly-Sync.md' && item.via === 'rel'),
      backlinksOf(store, FIXTURES_DIR, 'people/Nobody.md'),
    ],
    expected: [true, true, []],
  })
  const app = createTestHttpApp([`${FIXTURES_DIR}/people`], { markdownStore: store })
  const response = await app.request('http://localhost/docs/_api/backlinks?path=people/Chen-Wei.md&limit=1')
  const body = (await response.json()) as { items: { path: string }[]; total: number }
  assert({
    given: 'the route with a limit of one',
    should: 'answer one item and the total',
    actual: [body.items.length, body.total >= 1],
    expected: [1, true],
  })
})

test({ name: 'vocabulary - the notebook score orders a tie, and the hint says how long ago' }, async () => {
  const store = await storePromise
  const vocabulary = vocabularyOf(store, FIXTURES_DIR)
  const scoring = new ScoringStore()
  const today = new PlainDate('2026-01-20')
  scoring.recordPersonInteraction('Chen Wei', '2026-01-19', 10, today)
  scoring.recordTagInteraction('Work/Planning', '2026-01-19', today)
  const scores = scoresFrom(
    scoring.getPeopleWithScores(['Chen Wei', 'Casey Arden']),
    scoring.getOrgsWithScores([]),
    scoring.getTagsWithScores([...vocabulary.tags.keys()]),
  )
  const people = complete(vocabulary, { kind: 'people', query: 'c' }, scores, '2026-01-20')
  const tags = complete(vocabulary, { kind: 'tags', query: 'work' }, scores, '2026-01-20')
  assert({
    given: 'two people and two tags that match alike, one of each with a recent interaction',
    should: 'put the scored one first — the alphabet would not — and say when it was',
    actual: [people[0]?.value, people[0]?.hint?.endsWith('yesterday'), tags[0]?.value],
    expected: ['Chen Wei', true, 'Work/Planning'],
  })
  assert({
    given: 'days at several distances',
    should: 'read as today, yesterday, days, weeks, months, years',
    actual: ['2026-01-20', '2026-01-19', '2026-01-10', '2025-12-20', '2025-08-01', '2023-01-01'].map((day) =>
      ago(day, '2026-01-20'),
    ),
    expected: ['today', 'yesterday', '10 days ago', '4 weeks ago', '6 months ago', '3 years ago'],
  })
})

test({ name: 'vocabulary - a person with several names completes once, under any of them' }, async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'vocabulary-aliases-'))
  try {
    for (const dir of ['people', 'orgs', 'projects', 'time']) await mkdir(path.join(base, dir), { recursive: true })
    await writeFile(
      path.join(base, 'people/Jane-Doe.md'),
      '---\nname:\n  - Jane Doe\n  - Janie\nalt: JD\norg: Atlas\ntags: atlas\n---\n',
    )
    const store = await MarkdownStore.build({
      peopleDirs: [`${base}/people`],
      orgDirs: [`${base}/orgs`],
      projectsDir: `${base}/projects`,
      timeDirs: [`${base}/time`],
    })
    const vocabulary = vocabularyOf(store, base)
    assert({
      given: 'one person file listing three names, searched by each of them',
      should: 'complete as one row every time, and count her tag once',
      actual: [
        ['jane', 'janie', 'jd'].map((query) =>
          complete(vocabulary, { kind: 'people', query }).map((item) => item.value),
        ),
        vocabulary.tags.get('atlas'),
      ],
      expected: [[['Jane Doe'], ['Jane Doe'], ['Jane Doe']], 1],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
