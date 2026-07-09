import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import type { NameResolver } from './involves.ts'
import { matchesInvolvesAll } from './involvesAll.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesInvolvesAll
// =============================================================================

const fixtures = [
  {
    yaml: 'from: Alice Smith\nto: Bob Jones',
    names: ['Alice Smith', 'Bob Jones'],
    expected: true,
    description: 'every name involved',
  },
  {
    yaml: 'from: Alice Smith\nto: Bob Jones',
    names: ['Alice Smith', 'Carol Quinn'],
    expected: false,
    description: 'one name missing',
  },
  {
    yaml: 'who: Alice Smith, Bob Jones, Carol Quinn',
    names: ['Alice Smith', 'Bob Jones'],
    expected: true,
    description: 'names among a larger group',
  },
]

for (const { yaml, names, expected, description } of fixtures) {
  test(`matchesInvolvesAll - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match (AND semantics)' : 'not match',
      actual: matchesInvolvesAll(doc, names),
      expected,
    })
  })
}

// =============================================================================
// Name Resolution (PeopleStore aliases)
// =============================================================================

const mockResolver: NameResolver = (name: string) => {
  const aliases: Record<string, string[]> = {
    jw: ['James Robert Wheeler', 'JW', 'Jim Wheeler'],
    'jim wheeler': ['James Robert Wheeler', 'JW', 'Jim Wheeler'],
  }
  return aliases[name.toLowerCase()] ?? [name]
}

test('matchesInvolvesAll - resolves aliases per name', () => {
  const doc = md('from: Jim Wheeler\nto: Alice Smith')
  assert({
    given: 'an involvesAll list using a nickname for one participant',
    should: 'match via the name resolver',
    actual: matchesInvolvesAll(doc, ['JW', 'Alice Smith'], mockResolver),
    expected: true,
  })
})
