import { assert, test } from '#test'
import RelSet from './mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'

// Mock refs for testing
const mockRefs: ResolvedRef[] = [
  { type: 'person', value: { name: 'Alice' } as any, path: '/people/alice.md', raw: 'Alice' },
  { type: 'person', value: { name: 'Bob' } as any, path: '/people/bob.md', raw: 'Bob' },
  { type: 'org', value: { name: 'Acme' } as any, path: '/orgs/acme.md', raw: 'Acme Corp' },
  { type: 'url', value: new URL('https://example.com'), raw: 'https://example.com' },
  {
    type: 'document',
    value: { yaml: { title: 'Meeting' } } as any,
    path: '/time/2025/01/meeting.md',
    raw: '01-15/meeting',
  },
  { type: 'unresolved', value: null, raw: 'Unknown Person' },
]

test('RelSet - constructor with refs', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'array of refs',
    should: 'have correct size',
    actual: set.size,
    expected: 6,
  })
})

test('RelSet.from - creates from iterable', () => {
  const set = RelSet.from(mockRefs)

  assert({
    given: 'iterable of refs',
    should: 'have correct size',
    actual: set.size,
    expected: 6,
  })
})

test('RelSet.people - returns only person refs', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 2 people',
    actual: set.people.length,
    expected: 2,
  })

  assert({
    given: 'mixed refs',
    should: 'include paths',
    actual: set.people.map((p) => p.path),
    expected: ['/people/alice.md', '/people/bob.md'],
  })
})

test('RelSet.orgs - returns only org refs', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 1 org',
    actual: set.orgs.length,
    expected: 1,
  })

  assert({
    given: 'mixed refs',
    should: 'include path',
    actual: set.orgs[0].path,
    expected: '/orgs/acme.md',
  })
})

test('RelSet.documents - returns only document refs', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 1 document',
    actual: set.documents.length,
    expected: 1,
  })

  assert({
    given: 'mixed refs',
    should: 'include path',
    actual: set.documents[0].path,
    expected: '/time/2025/01/meeting.md',
  })
})

test('RelSet.urls - returns only URL refs', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 1 URL',
    actual: set.urls.length,
    expected: 1,
  })

  assert({
    given: 'mixed refs',
    should: 'have correct href',
    actual: set.urls[0].value.href,
    expected: 'https://example.com/',
  })
})

test('RelSet.unresolved - returns only unresolved raw strings', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 1 unresolved',
    actual: set.unresolved,
    expected: ['Unknown Person'],
  })
})

test('RelSet.paths - returns all file paths', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'mixed refs',
    should: 'return 4 paths (person, org, document)',
    actual: set.paths.length,
    expected: 4,
  })

  assert({
    given: 'mixed refs',
    should: 'include all file-backed paths',
    actual: set.paths,
    expected: ['/people/alice.md', '/people/bob.md', '/orgs/acme.md', '/time/2025/01/meeting.md'],
  })
})

test('RelSet.allResolved - false when has unresolved', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'refs with unresolved',
    should: 'return false',
    actual: set.allResolved,
    expected: false,
  })
})

test('RelSet.allResolved - true when all resolved', () => {
  const resolvedOnly = mockRefs.filter((r) => r.type !== 'unresolved')
  const set = new RelSet(resolvedOnly)

  assert({
    given: 'refs without unresolved',
    should: 'return true',
    actual: set.allResolved,
    expected: true,
  })
})

test('RelSet.hasUnresolved - true when has unresolved', () => {
  const set = new RelSet(mockRefs)

  assert({
    given: 'refs with unresolved',
    should: 'return true',
    actual: set.hasUnresolved,
    expected: true,
  })
})

test('RelSet.toArray - returns copy of refs', () => {
  const set = new RelSet(mockRefs)
  const arr = set.toArray()

  assert({
    given: 'RelSet',
    should: 'return array of same length',
    actual: arr.length,
    expected: 6,
  })
})

test('RelSet - iterable', () => {
  const set = new RelSet(mockRefs)
  const collected = [...set]

  assert({
    given: 'RelSet spread',
    should: 'yield all refs',
    actual: collected.length,
    expected: 6,
  })
})

test('RelSet - empty set', () => {
  const set = new RelSet()

  assert({
    given: 'empty RelSet',
    should: 'have size 0',
    actual: set.size,
    expected: 0,
  })

  assert({
    given: 'empty RelSet',
    should: 'have no people',
    actual: set.people.length,
    expected: 0,
  })

  assert({
    given: 'empty RelSet',
    should: 'have allResolved true',
    actual: set.allResolved,
    expected: true,
  })
})
