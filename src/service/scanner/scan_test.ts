import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { Store } from '../store.ts'
import { createScanners, type EntityChecker } from './scan.ts'

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
