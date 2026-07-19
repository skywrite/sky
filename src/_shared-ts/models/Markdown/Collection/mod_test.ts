import { assert, test } from '#test'
import Collection from './mod.ts'
import Document from '../Document/mod.ts'

// Helper to create test documents
function makeDoc(content: string): Document {
  return Document.fromMarkdown(content)
}

// -----------------------------------------------------------------------------
// Creation fixtures
// -----------------------------------------------------------------------------

test('Collection.empty creates empty collection', () => {
  const c = Collection.empty()

  assert({
    given: 'Collection.empty()',
    should: 'have size 0',
    actual: c.size,
    expected: 0,
  })

  assert({
    given: 'Collection.empty()',
    should: 'be empty',
    actual: c.isEmpty,
    expected: true,
  })
})

test('Collection.from creates from array', () => {
  const doc1 = makeDoc('---\ntitle: One\n---\nContent 1')
  const doc2 = makeDoc('---\ntitle: Two\n---\nContent 2')

  const c = Collection.from([
    { doc: doc1, path: '/a.md' },
    { doc: doc2, path: '/b.md' },
  ])

  assert({
    given: 'two documents',
    should: 'have size 2',
    actual: c.size,
    expected: 2,
  })

  assert({
    given: 'two documents',
    should: 'not be empty',
    actual: c.isEmpty,
    expected: false,
  })
})

test('Collection.of creates from single doc', () => {
  const doc = makeDoc('# Hello')
  const c = Collection.of(doc, '/hello.md')

  assert({
    given: 'single document',
    should: 'have size 1',
    actual: c.size,
    expected: 1,
  })

  assert({
    given: 'single document',
    should: 'return doc as first()',
    actual: c.first()?.markdown,
    expected: doc.markdown,
  })
})

// -----------------------------------------------------------------------------
// Accessor fixtures
// -----------------------------------------------------------------------------

const accessorFixtures = [
  { path: '/one.md', content: '# Doc 1' },
  { path: '/two.md', content: '# Doc 2' },
]

test('Collection accessors - paths', () => {
  const c = Collection.from(accessorFixtures.map((f) => ({ doc: makeDoc(f.content), path: f.path })))

  assert({
    given: 'collection with two docs',
    should: 'return both paths',
    actual: c.paths,
    expected: ['/one.md', '/two.md'],
  })
})

test('Collection accessors - getAll', () => {
  const c = Collection.from(accessorFixtures.map((f) => ({ doc: makeDoc(f.content), path: f.path })))

  assert({
    given: 'collection with two docs',
    should: 'return two documents',
    actual: c.getAll().length,
    expected: 2,
  })
})

test('Collection accessors - get by path', () => {
  const c = Collection.from(accessorFixtures.map((f) => ({ doc: makeDoc(f.content), path: f.path })))

  assert({
    given: 'valid path',
    should: 'return document',
    actual: c.get('/one.md')?.markdown,
    expected: '# Doc 1',
  })

  assert({
    given: 'invalid path',
    should: 'return undefined',
    actual: c.get('/nonexistent.md'),
    expected: undefined,
  })
})

test('Collection accessors - has', () => {
  const c = Collection.from(accessorFixtures.map((f) => ({ doc: makeDoc(f.content), path: f.path })))

  assert({
    given: 'existing path',
    should: 'return true',
    actual: c.has('/one.md'),
    expected: true,
  })

  assert({
    given: 'nonexistent path',
    should: 'return false',
    actual: c.has('/nonexistent.md'),
    expected: false,
  })
})

// -----------------------------------------------------------------------------
// Filter fixtures
// -----------------------------------------------------------------------------

test('Collection.filter by predicate', () => {
  const doc1 = makeDoc('---\nstatus: active\n---\n')
  const doc2 = makeDoc('---\nstatus: archived\n---\n')

  const c = Collection.from([
    { doc: doc1, path: '/a.md' },
    { doc: doc2, path: '/b.md' },
  ])

  const active = c.filter((doc) => doc.yaml['status'] === 'active')

  assert({
    given: 'filter for active status',
    should: 'return 1 document',
    actual: active.size,
    expected: 1,
  })

  assert({
    given: 'filter for active status',
    should: 'contain only active doc',
    actual: active.first()?.yaml['status'],
    expected: 'active',
  })
})

test('Collection.filter receives path', () => {
  const doc = makeDoc('# Test')
  const c = Collection.from([
    { doc, path: '/people/john.md' },
    { doc, path: '/orgs/acme.md' },
  ])

  const people = c.filter((_, path) => path.includes('/people/'))

  assert({
    given: 'filter by path pattern',
    should: 'return matching paths only',
    actual: people.paths,
    expected: ['/people/john.md'],
  })
})

// -----------------------------------------------------------------------------
// Find fixtures
// -----------------------------------------------------------------------------

test('Collection.find returns first match', () => {
  const doc1 = makeDoc('---\nname: first\n---\n')
  const doc2 = makeDoc('---\nname: second\n---\n')

  const c = Collection.from([
    { doc: doc1, path: '/a.md' },
    { doc: doc2, path: '/b.md' },
  ])

  const found = c.find((doc) => doc.yaml['name'] === 'second')

  assert({
    given: 'find with matching predicate',
    should: 'return matching document',
    actual: found?.yaml['name'],
    expected: 'second',
  })
})

test('Collection.find returns undefined when not found', () => {
  const c = Collection.from([{ doc: makeDoc('test'), path: '/a.md' }])

  assert({
    given: 'find with no matches',
    should: 'return undefined',
    actual: c.find(() => false),
    expected: undefined,
  })
})

// -----------------------------------------------------------------------------
// Merge fixtures
// -----------------------------------------------------------------------------

test('Collection.merge combines collections', () => {
  const doc1 = makeDoc('One')
  const doc2 = makeDoc('Two')
  const doc3 = makeDoc('Three')

  const c1 = Collection.from([
    { doc: doc1, path: '/one.md' },
    { doc: doc2, path: '/two.md' },
  ])

  const c2 = Collection.from([{ doc: doc3, path: '/three.md' }])

  const merged = c1.merge(c2)

  assert({
    given: 'merge two collections',
    should: 'contain all documents',
    actual: merged.size,
    expected: 3,
  })
})

test('Collection.merge skips duplicates', () => {
  const doc1 = makeDoc('Original')
  const doc2 = makeDoc('Duplicate')

  const c1 = Collection.from([{ doc: doc1, path: '/same.md' }])
  const c2 = Collection.from([{ doc: doc2, path: '/same.md' }])

  const merged = c1.merge(c2)

  assert({
    given: 'merge with duplicate path',
    should: 'keep first collection doc',
    actual: merged.first()?.markdown,
    expected: 'Original',
  })

  assert({
    given: 'merge with duplicate path',
    should: 'have size 1',
    actual: merged.size,
    expected: 1,
  })
})

// -----------------------------------------------------------------------------
// Add/Remove fixtures
// -----------------------------------------------------------------------------

test('Collection.add adds document', () => {
  const doc1 = makeDoc('One')
  const doc2 = makeDoc('Two')

  const c = Collection.of(doc1, '/one.md')
  const added = c.add(doc2, '/two.md')

  assert({
    given: 'add document',
    should: 'not modify original',
    actual: c.size,
    expected: 1,
  })

  assert({
    given: 'add document',
    should: 'return new collection with both',
    actual: added.size,
    expected: 2,
  })
})

test('Collection.add skips existing path', () => {
  const doc1 = makeDoc('One')
  const doc2 = makeDoc('Two')

  const c = Collection.of(doc1, '/same.md')
  const added = c.add(doc2, '/same.md')

  assert({
    given: 'add with existing path',
    should: 'return same collection',
    actual: added === c,
    expected: true,
  })
})

test('Collection.remove removes document', () => {
  const doc = makeDoc('Test')
  const c = Collection.of(doc, '/test.md')
  const removed = c.remove('/test.md')

  assert({
    given: 'remove document',
    should: 'not modify original',
    actual: c.size,
    expected: 1,
  })

  assert({
    given: 'remove document',
    should: 'return empty collection',
    actual: removed.size,
    expected: 0,
  })
})

test('Collection.remove returns same if path not found', () => {
  const c = Collection.of(makeDoc('Test'), '/test.md')
  const removed = c.remove('/nonexistent.md')

  assert({
    given: 'remove nonexistent path',
    should: 'return same collection',
    actual: removed === c,
    expected: true,
  })
})

// -----------------------------------------------------------------------------
// Entity type detection fixtures
// -----------------------------------------------------------------------------

const entityTypeFixtures = [
  { path: '/people/john.md', expectedType: 'person', description: 'people directory' },
  { path: '/orgs/acme.md', expectedType: 'org', description: 'orgs directory' },
  { path: '/decisions/2026/01/test.md', expectedType: 'decision', description: 'decisions directory' },
  { path: '/goals/personal.md', expectedType: 'goal', description: 'goals directory' },
  { path: '/projects/open/alpha/_project/overview.md', expectedType: 'project', description: 'project overview' },
  { path: '/time/2026/01/29/journal/morning.md', expectedType: 'journal', description: 'journal directory' },
  { path: '/time/2026/01/29/meeting/standup.md', expectedType: 'meeting', description: 'meeting directory' },
  { path: '/messages/slack/thread.md', expectedType: 'message', description: 'messages directory' },
  { path: '/time/2026/01/29/day.md', expectedType: 'day', description: 'day.md file' },
  { path: '/random/file.md', expectedType: 'document', description: 'unknown path' },
]

entityTypeFixtures.forEach((fixture) => {
  test(`Entity type detection - ${fixture.description}`, () => {
    const doc = makeDoc('Test')
    const c = Collection.of(doc, fixture.path)

    assert({
      given: `path ${fixture.path}`,
      should: `detect type as ${fixture.expectedType}`,
      actual: c.getAllItems()[0].type,
      expected: fixture.expectedType,
    })
  })
})

test('Entity type detection - type hint override', () => {
  const doc = makeDoc('Test')
  const c = Collection.of(doc, '/some/path.md', 'meeting')

  assert({
    given: 'type hint provided',
    should: 'use hint instead of path detection',
    actual: c.getAllItems()[0].type,
    expected: 'meeting',
  })
})

// -----------------------------------------------------------------------------
// toMarkdown fixtures
// -----------------------------------------------------------------------------

test('Collection.toMarkdown outputs delimited format', () => {
  const doc = makeDoc('---\ntitle: Test\n---\n\nContent here')
  const c = Collection.of(doc, '/test.md')

  const md = c.toMarkdown()

  assert({
    given: 'default toMarkdown',
    should: 'include START FILE marker',
    actual: md.includes('<!-- START FILE -->'),
    expected: true,
  })

  assert({
    given: 'default toMarkdown',
    should: 'include path comment',
    actual: md.includes('<!-- /test.md -->'),
    expected: true,
  })

  assert({
    given: 'default toMarkdown',
    should: 'include END FILE marker',
    actual: md.includes('<!-- END FILE -->'),
    expected: true,
  })
})

test('Collection.toMarkdown relativeTo option', () => {
  const doc = makeDoc('Content')
  const c = Collection.of(doc, '/base/path/file.md')

  const md = c.toMarkdown({ relativeTo: '/base' })

  assert({
    given: 'relativeTo option',
    should: 'make path relative',
    actual: md.includes('<!-- path/file.md -->'),
    expected: true,
  })

  assert({
    given: 'relativeTo option',
    should: 'not include base path',
    actual: md.includes('<!-- /base'),
    expected: false,
  })
})

test('Collection.toMarkdown non-delimited', () => {
  const doc = makeDoc('Content')
  const c = Collection.of(doc, '/test.md')

  const md = c.toMarkdown({ delimited: false })

  assert({
    given: 'delimited: false',
    should: 'not include START FILE marker',
    actual: md.includes('<!-- START FILE -->'),
    expected: false,
  })
})

test('Collection.toMarkdown sorted output', () => {
  const doc = makeDoc('Test')

  const c = Collection.from([
    { doc, path: '/time/journal/a.md' }, // journal = 7
    { doc, path: '/people/john.md' }, // person = 1
    { doc, path: '/orgs/acme.md' }, // org = 0
    { doc, path: '/decisions/test.md' }, // decision = 3
  ])

  const md = c.toMarkdown({ sorted: true })
  const lines = md.split('\n')
  const pathLines = lines.filter(
    (l) => l.startsWith('<!-- ') && l.includes('.md') && !l.includes('START') && !l.includes('END'),
  )

  assert({
    given: 'sorted output',
    should: 'have org first',
    actual: pathLines[0].includes('orgs'),
    expected: true,
  })

  assert({
    given: 'sorted output',
    should: 'have person second',
    actual: pathLines[1].includes('people'),
    expected: true,
  })

  assert({
    given: 'sorted output',
    should: 'have decision third',
    actual: pathLines[2].includes('decisions'),
    expected: true,
  })

  assert({
    given: 'sorted output',
    should: 'have journal last',
    actual: pathLines[3].includes('journal'),
    expected: true,
  })
})

// -----------------------------------------------------------------------------
// Iteration fixtures
// -----------------------------------------------------------------------------

test('Collection forEach iterates all docs', () => {
  const paths: string[] = []
  const c = Collection.from([
    { doc: makeDoc('A'), path: '/a.md' },
    { doc: makeDoc('B'), path: '/b.md' },
  ])

  c.forEach((_, path) => paths.push(path))

  assert({
    given: 'forEach',
    should: 'iterate all paths',
    actual: paths,
    expected: ['/a.md', '/b.md'],
  })
})

test('Collection supports for...of', () => {
  const paths: string[] = []
  const c = Collection.from([
    { doc: makeDoc('A'), path: '/a.md' },
    { doc: makeDoc('B'), path: '/b.md' },
  ])

  for (const item of c) {
    paths.push(item.path)
  }

  assert({
    given: 'for...of iteration',
    should: 'yield all items',
    actual: paths,
    expected: ['/a.md', '/b.md'],
  })
})

// -----------------------------------------------------------------------------
// toArray fixture
// -----------------------------------------------------------------------------

test('Collection.toArray returns doc/path pairs', () => {
  const doc = makeDoc('Test')
  const c = Collection.of(doc, '/test.md')

  const arr = c.toArray()

  assert({
    given: 'toArray',
    should: 'return array with correct length',
    actual: arr.length,
    expected: 1,
  })

  assert({
    given: 'toArray',
    should: 'include path',
    actual: arr[0].path,
    expected: '/test.md',
  })
})

// -----------------------------------------------------------------------------
// toMarkdown - all items included
// -----------------------------------------------------------------------------

test('Collection.toMarkdown includes all document content', () => {
  const doc1 = makeDoc('---\ntitle: First\n---\n\n# First Document\n\nFirst content here.')
  const doc2 = makeDoc('---\ntitle: Second\n---\n\n# Second Document\n\nSecond content here.')
  const doc3 = makeDoc('---\ntitle: Third\n---\n\n# Third Document\n\nThird content here.')

  const c = Collection.from([
    { doc: doc1, path: '/first.md' },
    { doc: doc2, path: '/second.md' },
    { doc: doc3, path: '/third.md' },
  ])

  const md = c.toMarkdown()

  assert({
    given: 'three documents',
    should: 'include first document title',
    actual: md.includes('title: First'),
    expected: true,
  })

  assert({
    given: 'three documents',
    should: 'include first document content',
    actual: md.includes('First content here'),
    expected: true,
  })

  assert({
    given: 'three documents',
    should: 'include second document title',
    actual: md.includes('title: Second'),
    expected: true,
  })

  assert({
    given: 'three documents',
    should: 'include second document content',
    actual: md.includes('Second content here'),
    expected: true,
  })

  assert({
    given: 'three documents',
    should: 'include third document title',
    actual: md.includes('title: Third'),
    expected: true,
  })

  assert({
    given: 'three documents',
    should: 'include third document content',
    actual: md.includes('Third content here'),
    expected: true,
  })

  // Count START FILE markers to verify all 3 are present
  const startMarkers = (md.match(/<!-- START FILE -->/g) || []).length

  assert({
    given: 'three documents',
    should: 'have 3 START FILE markers',
    actual: startMarkers,
    expected: 3,
  })
})

test('Collection.toMarkdown includes all paths', () => {
  const doc = makeDoc('Content')
  const c = Collection.from([
    { doc, path: '/path/to/first.md' },
    { doc, path: '/path/to/second.md' },
    { doc, path: '/path/to/third.md' },
  ])

  const md = c.toMarkdown()

  assert({
    given: 'three paths',
    should: 'include first path',
    actual: md.includes('<!-- /path/to/first.md -->'),
    expected: true,
  })

  assert({
    given: 'three paths',
    should: 'include second path',
    actual: md.includes('<!-- /path/to/second.md -->'),
    expected: true,
  })

  assert({
    given: 'three paths',
    should: 'include third path',
    actual: md.includes('<!-- /path/to/third.md -->'),
    expected: true,
  })
})

test('Collection.toMarkdown excludes path when includePath is false', () => {
  const doc = makeDoc('Content')
  const c = Collection.of(doc, '/path/to/file.md')

  const md = c.toMarkdown({ includePath: false })

  assert({
    given: 'includePath: false',
    should: 'not include path comment',
    actual: md.includes('/path/to/file.md'),
    expected: false,
  })

  assert({
    given: 'includePath: false',
    should: 'still include START FILE marker',
    actual: md.includes('<!-- START FILE -->'),
    expected: true,
  })

  assert({
    given: 'includePath: false',
    should: 'still include content',
    actual: md.includes('Content'),
    expected: true,
  })
})

test('Collection.toMarkdown uses custom separator', () => {
  const doc1 = makeDoc('First')
  const doc2 = makeDoc('Second')

  const c = Collection.from([
    { doc: doc1, path: '/first.md' },
    { doc: doc2, path: '/second.md' },
  ])

  const md = c.toMarkdown({ separator: '\n\n===SEPARATOR===\n\n' })

  assert({
    given: 'custom separator',
    should: 'use provided separator',
    actual: md.includes('===SEPARATOR==='),
    expected: true,
  })
})

test('Collection.toMarkdown empty collection returns empty string', () => {
  const c = Collection.empty()
  const md = c.toMarkdown()

  assert({
    given: 'empty collection',
    should: 'return empty string',
    actual: md,
    expected: '',
  })
})

// -----------------------------------------------------------------------------
// Merge scenarios
// -----------------------------------------------------------------------------

test('Collection.merge - three collections', () => {
  const c1 = Collection.from([{ doc: makeDoc('A'), path: '/a.md' }])
  const c2 = Collection.from([{ doc: makeDoc('B'), path: '/b.md' }])
  const c3 = Collection.from([{ doc: makeDoc('C'), path: '/c.md' }])

  const merged = c1.merge(c2).merge(c3)

  assert({
    given: 'three merged collections',
    should: 'have size 3',
    actual: merged.size,
    expected: 3,
  })

  assert({
    given: 'three merged collections',
    should: 'have all paths',
    actual: merged.paths.sort(),
    expected: ['/a.md', '/b.md', '/c.md'],
  })
})

test('Collection.merge - mixed entity types preserves sorting', () => {
  const c1 = Collection.from([{ doc: makeDoc('Journal'), path: '/time/journal/entry.md' }])
  const c2 = Collection.from([{ doc: makeDoc('Person'), path: '/people/alice.md' }])
  const c3 = Collection.from([{ doc: makeDoc('Org'), path: '/orgs/acme.md' }])

  const merged = c1.merge(c2).merge(c3)
  const md = merged.toMarkdown({ sorted: true })
  const lines = md.split('\n')
  const pathLines = lines.filter(
    (l) => l.startsWith('<!-- ') && l.includes('.md') && !l.includes('START') && !l.includes('END'),
  )

  assert({
    given: 'merged mixed types',
    should: 'sort org first',
    actual: pathLines[0].includes('orgs'),
    expected: true,
  })

  assert({
    given: 'merged mixed types',
    should: 'sort person second',
    actual: pathLines[1].includes('people'),
    expected: true,
  })

  assert({
    given: 'merged mixed types',
    should: 'sort journal last',
    actual: pathLines[2].includes('journal'),
    expected: true,
  })
})

test('Collection.merge - with overlapping paths keeps first', () => {
  const c1 = Collection.from([
    { doc: makeDoc('Original A'), path: '/shared.md' },
    { doc: makeDoc('Only in C1'), path: '/c1-only.md' },
  ])
  const c2 = Collection.from([
    { doc: makeDoc('Duplicate A'), path: '/shared.md' },
    { doc: makeDoc('Only in C2'), path: '/c2-only.md' },
  ])

  const merged = c1.merge(c2)

  assert({
    given: 'overlapping paths',
    should: 'have size 3 (not 4)',
    actual: merged.size,
    expected: 3,
  })

  assert({
    given: 'overlapping paths',
    should: 'keep original content',
    actual: merged.get('/shared.md')?.markdown,
    expected: 'Original A',
  })

  assert({
    given: 'overlapping paths',
    should: 'include c1-only',
    actual: merged.has('/c1-only.md'),
    expected: true,
  })

  assert({
    given: 'overlapping paths',
    should: 'include c2-only',
    actual: merged.has('/c2-only.md'),
    expected: true,
  })
})

test('Collection.merge - empty with non-empty', () => {
  const empty = Collection.empty()
  const nonEmpty = Collection.from([
    { doc: makeDoc('A'), path: '/a.md' },
    { doc: makeDoc('B'), path: '/b.md' },
  ])

  const merged1 = empty.merge(nonEmpty)
  const merged2 = nonEmpty.merge(empty)

  assert({
    given: 'empty merged with non-empty',
    should: 'have same size as non-empty',
    actual: merged1.size,
    expected: 2,
  })

  assert({
    given: 'non-empty merged with empty',
    should: 'have same size as non-empty',
    actual: merged2.size,
    expected: 2,
  })
})

test('Collection.merge - multiple duplicates across collections', () => {
  const c1 = Collection.from([
    { doc: makeDoc('A1'), path: '/a.md' },
    { doc: makeDoc('B1'), path: '/b.md' },
  ])
  const c2 = Collection.from([
    { doc: makeDoc('A2'), path: '/a.md' },
    { doc: makeDoc('C2'), path: '/c.md' },
  ])
  const c3 = Collection.from([
    { doc: makeDoc('A3'), path: '/a.md' },
    { doc: makeDoc('B3'), path: '/b.md' },
    { doc: makeDoc('D3'), path: '/d.md' },
  ])

  const merged = c1.merge(c2).merge(c3)

  assert({
    given: 'multiple overlapping collections',
    should: 'have 4 unique paths',
    actual: merged.size,
    expected: 4,
  })

  assert({
    given: 'multiple overlapping collections',
    should: 'keep first A',
    actual: merged.get('/a.md')?.markdown,
    expected: 'A1',
  })

  assert({
    given: 'multiple overlapping collections',
    should: 'keep first B',
    actual: merged.get('/b.md')?.markdown,
    expected: 'B1',
  })

  assert({
    given: 'multiple overlapping collections',
    should: 'have C from c2',
    actual: merged.get('/c.md')?.markdown,
    expected: 'C2',
  })

  assert({
    given: 'multiple overlapping collections',
    should: 'have D from c3',
    actual: merged.get('/d.md')?.markdown,
    expected: 'D3',
  })
})

test('Collection.merge - toMarkdown includes all merged items', () => {
  const c1 = Collection.from([{ doc: makeDoc('---\ntitle: Alpha\n---\nAlpha content'), path: '/alpha.md' }])
  const c2 = Collection.from([{ doc: makeDoc('---\ntitle: Beta\n---\nBeta content'), path: '/beta.md' }])
  const c3 = Collection.from([{ doc: makeDoc('---\ntitle: Gamma\n---\nGamma content'), path: '/gamma.md' }])

  const merged = c1.merge(c2).merge(c3)
  const md = merged.toMarkdown()

  assert({
    given: 'merged collections',
    should: 'include Alpha content',
    actual: md.includes('Alpha content'),
    expected: true,
  })

  assert({
    given: 'merged collections',
    should: 'include Beta content',
    actual: md.includes('Beta content'),
    expected: true,
  })

  assert({
    given: 'merged collections',
    should: 'include Gamma content',
    actual: md.includes('Gamma content'),
    expected: true,
  })

  const startMarkers = (md.match(/<!-- START FILE -->/g) || []).length

  assert({
    given: 'merged collections',
    should: 'have 3 START FILE markers',
    actual: startMarkers,
    expected: 3,
  })
})
