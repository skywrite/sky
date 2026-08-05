import ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import { assert, test } from '#test'
import Document from './mod.ts'

const fixtures = [
  {
    description: 'add single rel as string to empty',
    initial: { title: 'Test' },
    addRel: 'bob',
    expectedHas: ['bob'],
    expectedSize: 1,
  },
  {
    description: 'add single rel as string to existing',
    initial: { title: 'Test', rel: ['alice'] },
    addRel: 'bob',
    expectedHas: ['alice', 'bob'],
    expectedSize: 2,
  },
  {
    description: 'add multiple rel as string',
    initial: { title: 'Test', rel: ['alice'] },
    addRel: 'bob; steve',
    expectedHas: ['alice', 'bob', 'steve'],
    expectedSize: 3,
  },
  {
    description: 'add ImmutableSet to empty',
    initial: { title: 'Test' },
    addRel: ImmutableSet._fromArray(ImmutableSet<string>, ['bob', 'steve']),
    expectedHas: ['bob', 'steve'],
    expectedSize: 2,
  },
  {
    description: 'add ImmutableSet to existing',
    initial: { title: 'Test', rel: ['alice', 'charlie'] },
    addRel: ImmutableSet._fromArray(ImmutableSet<string>, ['bob', 'steve']),
    expectedHas: ['alice', 'charlie', 'bob', 'steve'],
    expectedSize: 4,
  },
  {
    description: 'add duplicate value (no duplicates in set)',
    initial: { title: 'Test', rel: ['bob', 'alice'] },
    addRel: 'bob',
    expectedHas: ['bob', 'alice'],
    expectedSize: 2,
  },
  {
    description: 'add empty string',
    initial: { title: 'Test', rel: ['bob'] },
    addRel: '',
    expectedHas: ['bob'],
    expectedSize: 1,
  },
]

fixtures.forEach((fixture) => {
  test(`Document.addRel - ${fixture.description}`, () => {
    const doc = new Document(fixture.initial, '# Test')
    const updated = doc.addRel(fixture.addRel)

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

test('Document.addRel - has() works with added values', () => {
  const doc = new Document({ rel: ['alice'] }, '# Test')
  const updated = doc.addRel('bob; steve')

  assert({
    given: 'document with added rel values',
    should: 'have original value',
    actual: updated.rel.has('alice'),
    expected: true,
  })

  assert({
    given: 'document with added rel values',
    should: 'have first added value',
    actual: updated.rel.has('bob'),
    expected: true,
  })

  assert({
    given: 'document with added rel values',
    should: 'have second added value',
    actual: updated.rel.has('steve'),
    expected: true,
  })
})
