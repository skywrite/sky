import { assert, test } from '#test'
import PersonDocument from '#shared/models/Person/mod.ts'

test('Person constructor - normalizes who to name when who exists', () => {
  const person = new PersonDocument({ who: 'John Doe' })

  assert({
    given: 'person with who field',
    should: 'convert who to name',
    actual: person.yaml['name'],
    expected: 'John Doe',
  })

  assert({
    given: 'person with who field',
    should: 'remove who field',
    actual: person.yaml['who'],
    expected: undefined,
  })
})

test('Person constructor - normalizes who array to name when who exists', () => {
  const person = new PersonDocument({ who: ['John Doe', 'Jane Doe'] })

  assert({
    given: 'person with who array',
    should: 'convert who array to name',
    actual: person.yaml['name'],
    expected: ['John Doe', 'Jane Doe'],
  })

  assert({
    given: 'person with who array',
    should: 'remove who field',
    actual: person.yaml['who'],
    expected: undefined,
  })
})

test('Person constructor - preserves existing name when who does not exist', () => {
  const person = new PersonDocument({ name: 'John Doe' })

  assert({
    given: 'person with name field only',
    should: 'preserve name field',
    actual: person.yaml['name'],
    expected: 'John Doe',
  })

  assert({
    given: 'person with name field only',
    should: 'not have who field',
    actual: person.yaml['who'],
    expected: undefined,
  })
})

test('Person constructor - who takes precedence when both who and name exist', () => {
  const person = new PersonDocument({ who: 'John from who', name: 'John from name' })

  assert({
    given: 'person with both who and name fields',
    should: 'use who value for name',
    actual: person.yaml['name'],
    expected: 'John from who',
  })

  assert({
    given: 'person with both who and name fields',
    should: 'remove who field',
    actual: person.yaml['who'],
    expected: undefined,
  })
})

test('Person constructor - handles missing name and who', () => {
  const person = new PersonDocument({})

  assert({
    given: 'person with no name or who',
    should: 'have undefined name',
    actual: person.yaml['name'],
    expected: undefined,
  })

  assert({
    given: 'person with no name or who',
    should: 'have undefined who',
    actual: person.yaml['who'],
    expected: undefined,
  })
})

test('Person constructor - handles null who', () => {
  const person = new PersonDocument({ who: null, name: 'John Doe' })

  assert({
    given: 'person with null who and existing name',
    should: 'preserve name (null is falsy)',
    actual: person.yaml['name'],
    expected: 'John Doe',
  })

  assert({
    given: 'person with null who',
    should: 'preserve null who (not deleted)',
    actual: person.yaml['who'],
    expected: null,
  })
})

test('Person constructor - handles empty string who', () => {
  const person = new PersonDocument({ who: '' })

  assert({
    given: 'person with empty string who',
    should: 'not convert to name (empty is falsy)',
    actual: person.yaml['name'],
    expected: undefined,
  })

  assert({
    given: 'person with empty string who',
    should: 'preserve empty who (not deleted)',
    actual: person.yaml['who'],
    expected: '',
  })
})

test('Person constructor - preserves other yaml fields during normalization', () => {
  const person = new PersonDocument({
    who: 'John Doe',
    email: 'john@example.com',
    title: 'Engineer',
  })

  assert({
    given: 'person with who and other fields',
    should: 'convert who to name',
    actual: person.yaml['name'],
    expected: 'John Doe',
  })

  assert({
    given: 'person with who and other fields',
    should: 'remove who field',
    actual: person.yaml['who'],
    expected: undefined,
  })

  assert({
    given: 'person with who and other fields',
    should: 'preserve email field',
    actual: person.yaml['email'],
    expected: 'john@example.com',
  })

  assert({
    given: 'person with who and other fields',
    should: 'preserve title field',
    actual: person.yaml['title'],
    expected: 'Engineer',
  })
})

test('PersonDocument.fromMarkdown - normalizes who to name from markdown', () => {
  const markdown = `---
who: Jane Doe
site: http://example.com
---

# Jane Doe`

  const person = PersonDocument.fromMarkdown(markdown)

  assert({
    given: 'markdown with who field',
    should: 'convert who to name',
    actual: person.yaml['name'],
    expected: 'Jane Doe',
  })

  assert({
    given: 'markdown with who field',
    should: 'remove who field',
    actual: person.yaml['who'],
    expected: undefined,
  })

  assert({
    given: 'markdown with other fields',
    should: 'preserve site field',
    actual: person.yaml['site'],
    expected: 'http://example.com',
  })
})

test('Person roundtrip - who to name conversion persists in markdown output', () => {
  const inputMarkdown = `---
who: Jane Doe
site: http://example.com
tags: Lego
---

# Jane Doe

Some content here.`

  const person = PersonDocument.fromMarkdown(inputMarkdown)
  const outputMarkdown = person.toMarkdown()

  assert({
    given: 'markdown with who field after roundtrip',
    should: 'contain name in output',
    actual: outputMarkdown.includes('name: Jane Doe'),
    expected: true,
  })

  assert({
    given: 'markdown with who field after roundtrip',
    should: 'not contain who in output',
    actual: outputMarkdown.includes('who:'),
    expected: false,
  })

  assert({
    given: 'markdown with who field after roundtrip',
    should: 'preserve other fields',
    actual: outputMarkdown.includes('site: http://example.com'),
    expected: true,
  })

  assert({
    given: 'markdown with who field after roundtrip',
    should: 'preserve markdown content',
    actual: outputMarkdown.includes('Some content here.'),
    expected: true,
  })
})
