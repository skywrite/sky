import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesInvolvesAny } from './involvesAny.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesInvolvesAny
// =============================================================================

const fixtures = [
  {
    yaml: 'from: Alice Smith\nto: Bob Jones',
    names: ['Alice Smith', 'Carol Quinn'],
    expected: true,
    description: 'one of the names involved',
  },
  {
    yaml: 'from: Alice Smith\nto: Bob Jones',
    names: ['Carol Quinn', 'Dave Park'],
    expected: false,
    description: 'none of the names involved',
  },
  {
    yaml: 'from: Alice Smith\nto: Bob Jones',
    names: ['Alice Smith', 'Bob Jones'],
    expected: true,
    description: 'all of the names involved',
  },
]

for (const { yaml, names, expected, description } of fixtures) {
  test(`matchesInvolvesAny - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match (OR semantics)' : 'not match',
      actual: matchesInvolvesAny(doc, names),
      expected,
    })
  })
}
