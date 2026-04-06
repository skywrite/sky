import { assert, test } from '#test'
import Document from './mod.ts'

const fixtures = [
  {
    description: 'undefined rel returns empty ImmutableSet',
    yaml: { title: 'Test' },
    markdown: '# Test',
    expectedHas: [],
    expectedSize: 0,
  },
  {
    description: 'empty array rel returns empty ImmutableSet',
    yaml: { title: 'Test', rel: [] },
    markdown: '# Test',
    expectedHas: [],
    expectedSize: 0,
  },
  {
    description: 'single rel value in array',
    yaml: { title: 'Test', rel: ['bob'] },
    markdown: '# Test',
    expectedHas: ['bob'],
    expectedSize: 1,
  },
  {
    description: 'multiple rel values as array',
    yaml: { title: 'Test', rel: ['bob', 'steve', 'susie'] },
    markdown: '# Test',
    expectedHas: ['bob', 'steve', 'susie'],
    expectedSize: 3,
  },
  {
    description: 'multiple rel values as string (backwards compat)',
    yaml: { title: 'Test', rel: 'bob; steve; susie' },
    markdown: '# Test',
    expectedHas: ['bob', 'steve', 'susie'],
    expectedSize: 3,
  },
]

fixtures.forEach((fixture) => {
  test(`Document.rel - ${fixture.description}`, () => {
    const doc = new Document(fixture.yaml, fixture.markdown)

    assert({
      given: fixture.description,
      should: `have size ${fixture.expectedSize}`,
      actual: doc.rel.size,
      expected: fixture.expectedSize,
    })

    fixture.expectedHas.forEach((value) => {
      assert({
        given: fixture.description,
        should: `have value "${value}"`,
        actual: doc.rel.has(value),
        expected: true,
      })
    })
  })
})

test('Document.rel - has() method works', () => {
  const doc = new Document({ rel: 'bob; steve; susie' }, '# Test')

  assert({
    given: 'document with rel "bob; steve; susie"',
    should: 'return true for has("bob")',
    actual: doc.rel.has('bob'),
    expected: true,
  })

  assert({
    given: 'document with rel "bob; steve; susie"',
    should: 'return false for has("alice")',
    actual: doc.rel.has('alice'),
    expected: false,
  })
})
