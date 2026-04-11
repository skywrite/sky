import { assert, test } from '#test'
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
