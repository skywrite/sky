import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { Store } from '../store.ts'
import type { EntityDetector } from './entities.ts'
import { createScanners, type EntityChecker } from './scan.ts'
import { processFileUpdate, scanFiles } from './walkDirs.ts'

const entityChecker: EntityChecker = {
  isTimeFile: () => true,
}

function makeMarkdown(tags: string[]): string {
  const yamlTags = tags.map((t) => `  - ${t}`).join('\n')
  return `---\ndate: 2026-01-15\ntags:\n${yamlTags}\n---\n\n# Content\n`
}

test('readFileAndUpdateTags: excludes projects/ tags from store', () => {
  const store = new Store()
  const { readFileAndUpdateTags } = createScanners(store, entityChecker)

  const content = makeMarkdown(['Finance', 'projects/Stock-Uplisting', 'Legal'])
  readFileAndUpdateTags(content)

  const tags = Array.from(store.tags)

  assert({
    given: 'markdown with projects/ tag and regular tags',
    should: 'include regular tags',
    expected: true,
    actual: tags.includes('Finance') && tags.includes('Legal'),
  })

  assert({
    given: 'markdown with projects/ tag and regular tags',
    should: 'exclude projects/ tag',
    expected: false,
    actual: tags.includes('projects/Stock-Uplisting'),
  })
})

test('readFileAndUpdateTags: keeps non-project slash tags', () => {
  const store = new Store()
  const { readFileAndUpdateTags } = createScanners(store, entityChecker)

  const content = makeMarkdown(['Acme/M&A', 'Assets/ETH'])
  readFileAndUpdateTags(content)

  const tags = Array.from(store.tags)

  assert({
    given: 'markdown with slash tags that are not projects/',
    should: 'include them',
    expected: true,
    actual: tags.includes('Acme/M&A') && tags.includes('Assets/ETH'),
  })
})

test('readFileAndUpdateTags: skips update when all tags are projects/', () => {
  const store = new Store()
  const { readFileAndUpdateTags } = createScanners(store, entityChecker)

  const content = makeMarkdown(['projects/Titan', 'projects/Banxa-MNA'])
  readFileAndUpdateTags(content)

  assert({
    given: 'markdown where all tags are projects/',
    should: 'store no tags',
    expected: 0,
    actual: store.tags.size,
  })
})

test('readFileAndUpdatePeople: the names a person file lists score as one person', () => {
  const store = new Store()
  const referenceDate = new PlainDate('2026-02-01')
  const { readFileAndUpdatePeople, trackPersonInteractions } = createScanners(store, entityChecker, { referenceDate })
  readFileAndUpdatePeople('---\nname:\n  - Jane Doe\n  - Janie\n---\n', '/nb/people/Jane-Doe.md')
  trackPersonInteractions('---\nwho: Janie\n---\n', '/nb/time/2026/W05/01-30/actions/meetings/09-00_Zoom_Janie_Sync.md')
  trackPersonInteractions(
    '---\nwho: jane doe\n---\n',
    '/nb/time/2026/W05/01-31/actions/messages/10-00_slack_Jane-Doe_Hello.md',
  )

  const scores = new Map(store.getPeopleWithScores().map((p) => [p.name, [p.score, p.lastInteraction]]))
  assert({
    given: 'a profile listing two names, a meeting under the nickname and a message under the lowercased name',
    should: 'report the meeting and the message as one person under either name',
    actual: [scores.get('Jane Doe'), scores.get('Janie')],
    expected: [
      [13, '2026-01-31'],
      [13, '2026-01-31'],
    ],
  })
})

test('forgetFile: a time file read again after a save counts once', () => {
  const store = new Store()
  const referenceDate = new PlainDate('2026-02-01')
  const { trackPersonInteractions, forgetFile } = createScanners(store, entityChecker, { referenceDate })
  const file = '/nb/time/2026/W05/01-30/actions/meetings/09-00_Zoom_Jane-Doe_Sync.md'
  trackPersonInteractions('---\nwho: Jane Doe\n---\n', file)
  forgetFile(file)
  trackPersonInteractions('---\nwho: Jane Doe, Sam Park\n---\n', file)
  store.update('people', new Set(['Jane Doe', 'Sam Park']))

  assert({
    given: 'the same meeting file read twice, forgotten between, a second attendee added',
    should: 'score each attendee for one meeting',
    actual: store.getPeopleWithScores().map((p) => [p.name, p.score, p.interactionCount]),
    expected: [
      ['Jane Doe', 10, 1],
      ['Sam Park', 10, 1],
    ],
  })
})

test('processFileUpdate: every save of a file scores it once', () => {
  const store = new Store()
  const referenceDate = new PlainDate('2026-02-01')
  const scanners = createScanners(store, entityChecker, { referenceDate })
  const detector: EntityDetector = {
    isPerson: (file) => file.includes('/people/'),
    isOrganization: () => false,
    isProject: () => false,
    isPlace: () => false,
    isTimeFile: (file) => file.includes('/time/'),
  }
  const file = '/nb/time/2026/W05/01-30/actions/meetings/09-00_Zoom_Jane-Doe_Sync.md'
  const contents = '---\nwho: Jane Doe\ntags: atlas\n---\n'
  for (let save = 0; save < 3; save++) processFileUpdate(contents, file, detector, scanners)
  store.update('people', new Set(['Jane Doe']))

  assert({
    given: 'one meeting file saved three times',
    should: 'score the attendee for one meeting and the tag for one file',
    actual: [
      store.getPeopleWithScores().map((p) => [p.name, p.score, p.interactionCount]),
      store.scoring.tagScores.get('atlas')?.fileCount,
    ],
    expected: [[['Jane Doe', 10, 1]], 1],
  })
})

test('person scoring distinguishes participants from related names and counts aliases once per file', () => {
  const store = new Store()
  const scanners = createScanners(store, entityChecker, { referenceDate: new PlainDate('2026-02-01') })
  scanners.readFileAndUpdatePeople('---\nname: [Jane Doe, Janie]\n---\n', '/nb/people/Jane-Doe.md')
  scanners.readFileAndUpdatePeople('---\nname: Sam Park\n---\n', '/nb/people/Sam-Park.md')
  scanners.readFileAndUpdatePeople('---\nname: Taylor Quinn\n---\n', '/nb/people/Taylor-Quinn.md')
  scanners.trackPersonInteractions(
    '---\nwho: [Janie, jane doe]\nrel: [Jane Doe, Taylor Quinn]\n---\n',
    '/nb/time/2026/W05/01-31/actions/meetings/09-00_Zoom_Team_Planning.md',
  )
  scanners.trackPersonInteractions(
    '---\nfrom: Sam Park\nto: Janie\nrel: [Taylor Quinn, Sam Park]\n---\n',
    '/nb/time/2026/W05/01-31/actions/emails/10-00_Email_Team_Planning.md',
  )
  const scores = new Map(
    store
      .getPeopleWithScores()
      .map((person) => [person.name, [person.score, person.familiarityScore, person.interactionCount]]),
  )
  assert({
    given: 'participants repeated in related fields and aliases, plus a person only discussed',
    should: 'give direct credit once per person and file, and only discounted relevance for the discussed person',
    actual: ['Jane Doe', 'Janie', 'Sam Park', 'Taylor Quinn'].map((name) => scores.get(name)),
    expected: [
      [15, 15, 2],
      [15, 15, 2],
      [5, 5, 1],
      [1.5, 0, 2],
    ],
  })
})

test('family scoring uses the exact tag hierarchy once per profile, survives rebuilds, and follows edits', () => {
  const store = new Store()
  const scanners = createScanners(store, entityChecker, { referenceDate: new PlainDate('2026-02-01') })
  const profiles = [
    { name: ['Jane Doe', 'Janie'], tags: ['Person/Family', 'Person/Family/Daughter'] },
    { name: ['Sam Park'], tags: ['Person/Family/Spouse'] },
    { name: ['Riley Ng'], tags: ['Person/Family/Son'], met: 'Never' },
    { name: ['Alex Chen'], tags: ['Person/FamilyFriends'] },
    { name: ['Taylor Quinn'], tags: ['Person/Spouse'] },
    { name: ['Pat Morgan'], tags: ['Organization/Family'] },
  ]
  profiles.forEach((profile, index) => {
    scanners.readFileAndUpdatePeople(`---\n${JSON.stringify(profile)}\n---\n`, `/nb/people/Contact-${index}.md`)
  })
  const score = (name: string) => {
    const person = store.getPeopleWithScores().find((person) => person.name === name)!
    return [person.score, person.familiarityScore, person.interactionCount]
  }
  assert({
    given: 'family and descendant tags, several aliases, lookalike tags, and a stale met flag',
    should: 'award one lasting bonus only through Person/Family, without inventing interactions',
    actual: ['Jane Doe', 'Janie', 'Sam Park', 'Riley Ng', 'Alex Chen', 'Taylor Quinn', 'Pat Morgan'].map(score),
    expected: [
      [100, 100, 0],
      [100, 100, 0],
      [100, 100, 0],
      [100, 100, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  })
  const replacement = new Store()
  replacement.replaceFrom(store)
  assert({
    given: 'the scanned store installed by a rebuild',
    should: 'keep the relationship bonus',
    actual: replacement.getPeopleWithScores().find((person) => person.name === 'Janie')?.familiarityScore,
    expected: 100,
  })
  scanners.readFileAndUpdatePeople('---\nname: [Jane Doe, Janie]\n---\n', '/nb/people/Contact-0.md')
  scanners.forgetFile('/nb/people/Contact-1.md')
  assert({
    given: 'one family tag removed and another profile forgotten',
    should: 'remove both bonuses immediately',
    actual: [score('Jane Doe'), score('Janie'), score('Sam Park')],
    expected: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  })
})

test('met dates contribute once for a person and unknown or Never values apply no penalty', () => {
  const store = new Store()
  const scanners = createScanners(store, entityChecker, { referenceDate: new PlainDate('2026-02-01') })
  scanners.readFileAndUpdatePeople('---\nname: [Jane Doe, Janie]\nmet: 2026-02-01\n---\n', '/nb/people/Jane-Doe.md')
  scanners.readFileAndUpdatePeople('---\nname: Sam Park\nmet: Never\n---\n', '/nb/people/Sam-Park.md')
  scanners.readFileAndUpdatePeople('---\nname: Taylor Quinn\n---\n', '/nb/people/Taylor-Quinn.md')
  assert({
    given: 'a dated meeting on a profile with aliases and two profiles without a known date',
    should: 'count one introduction and neither invent familiarity nor punish missing evidence',
    actual: store.getPeopleWithScores().map((person) => [person.name, person.score, person.familiarityScore]),
    expected: [
      ['Jane Doe', 5, 5],
      ['Janie', 5, 5],
      ['Sam Park', 0, 0],
      ['Taylor Quinn', 0, 0],
    ],
  })
})

test('scanFiles loads aliases before time files regardless of directory order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-person-scoring-'))
  try {
    const peopleDir = path.join(root, 'people')
    const meetingsDir = path.join(root, 'time/2026/W05/01-31/actions/meetings')
    await mkdir(peopleDir, { recursive: true })
    await mkdir(meetingsDir, { recursive: true })
    await writeFile(path.join(peopleDir, 'Jane-Doe.md'), '---\nname: [Jane Doe, Janie]\n---\n')
    await writeFile(path.join(meetingsDir, '09-00_Zoom_Planning.md'), '---\nwho: [Jane Doe, Janie]\nrel: Janie\n---\n')
    const store = new Store()
    const detector: EntityDetector = {
      isPerson: (file) => file.startsWith(peopleDir + path.sep),
      isOrganization: () => false,
      isProject: () => false,
      isPlace: () => false,
      isTimeFile: (file) => file.startsWith(meetingsDir + path.sep),
    }
    await scanFiles({
      dirs: [meetingsDir, peopleDir],
      store,
      entityDetector: detector,
      scanners: createScanners(store, detector, { referenceDate: new PlainDate('2026-02-01') }),
    })
    assert({
      given: 'a time directory visited before profiles, with several spellings of the same participant',
      should: 'score that person for one meeting under each alias',
      actual: store
        .getPeopleWithScores()
        .map((person) => [person.name, person.score, person.familiarityScore, person.interactionCount]),
      expected: [
        ['Jane Doe', 10, 10, 1],
        ['Janie', 10, 10, 1],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
