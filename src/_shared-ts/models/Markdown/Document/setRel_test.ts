import ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import { assert, test } from '#test'
import Document from './mod.ts'

const fixtures = [
  {
    description: 'set rel on document with no rel',
    initial: { title: 'Test' },
    setRel: ImmutableSet._fromArray(ImmutableSet<string>, ['bob', 'steve']),
    expectedHas: ['bob', 'steve'],
    expectedSize: 2,
  },
  {
    description: 'replace existing rel',
    initial: { title: 'Test', rel: ['alice', 'charlie'] },
    setRel: ImmutableSet._fromArray(ImmutableSet<string>, ['bob', 'steve']),
    expectedHas: ['bob', 'steve'],
    expectedSize: 2,
  },
  {
    description: 'set empty rel',
    initial: { title: 'Test', rel: ['bob', 'steve'] },
    setRel: new ImmutableSet<string>(),
    expectedHas: [],
    expectedSize: 0,
  },
  {
    description: 'set single rel value',
    initial: { title: 'Test' },
    setRel: ImmutableSet._fromArray(ImmutableSet<string>, ['bob']),
    expectedHas: ['bob'],
    expectedSize: 1,
  },
]

fixtures.forEach((fixture) => {
  test(`Document.setRel - ${fixture.description}`, () => {
    const doc = new Document(fixture.initial, '# Test')
    const updated = doc.setRel(fixture.setRel)

    assert({
      given: fixture.description,
      should: `have size ${fixture.expectedSize}`,
      actual: updated.rel.size,
      expected: fixture.expectedSize,
    })

    fixture.expectedHas.forEach((value) => {
      assert({
        given: fixture.description,
        should: `have value "${value}"`,
        actual: updated.rel.has(value),
        expected: true,
      })
    })

    // Verify immutability - original unchanged
    assert({
      given: fixture.description,
      should: 'not modify original document',
      actual: doc.rel.size,
      expected: Array.isArray(fixture.initial.rel) ? fixture.initial.rel.length : 0,
    })
  })
})

test('Document.setRel - stores as array in yaml', () => {
  const doc = new Document({ title: 'Test' }, '# Test')
  const updated = doc.setRel(ImmutableSet._fromArray(ImmutableSet<string>, ['bob', 'steve', 'susie']))

  assert({
    given: 'document with rel set',
    should: 'store rel as array in yaml',
    actual: Array.isArray(updated.yaml['rel']),
    expected: true,
  })

  assert({
    given: 'document with rel set',
    should: 'have correct array values',
    actual: (updated.yaml['rel'] as string[]).sort().join(','),
    expected: 'bob,steve,susie',
  })
})

test('Document.setRel - empty rel sets yaml to undefined', () => {
  const doc = new Document({ title: 'Test', rel: ['bob'] }, '# Test')
  const updated = doc.setRel(new ImmutableSet<string>())

  assert({
    given: 'document with empty rel set',
    should: 'set yaml rel to undefined',
    actual: updated.yaml['rel'],
    expected: undefined,
  })
})

test('Document.setRel - markdown-link entries survive the YAML round-trip', () => {
  // rel can carry external artifact links: the serializer must quote the
  // string so `[` does not re-parse as a YAML flow sequence.
  const link = '[Atlas Revenue Model](https://docs.google.com/spreadsheets/d/abc123/edit)'
  const doc = new Document({ title: 'Test' }, '# Test').setRel(ImmutableSet._fromArray(ImmutableSet<string>, [link]))
  const reparsed = Document.fromMarkdown(doc.toMarkdown())

  assert({
    given: 'a rel entry shaped as a markdown link',
    should: 'come back as the same single string after serialize + parse',
    actual: Array.from(reparsed.rel),
    expected: [link],
  })
})
