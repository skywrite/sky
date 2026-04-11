import { assert, test } from '#test'
import PersonDocument from '#shared/models/Person/mod.ts'

test('Person.names - returns array with single name when name is string', () => {
  const person = new PersonDocument({ name: 'John Doe' })

  assert({
    given: 'person with string name',
    should: 'return array with single name',
    actual: person.names,
    expected: ['John Doe'],
  })
})

test('Person.names - returns array as-is when name is array', () => {
  const person = new PersonDocument({ name: ['John Doe', 'Jane Doe'] })

  assert({
    given: 'person with array name',
    should: 'return array as-is',
    actual: person.names,
    expected: ['John Doe', 'Jane Doe'],
  })
})

test('Person.names - returns empty array when name is undefined', () => {
  const person = new PersonDocument({})

  assert({
    given: 'person with no name',
    should: 'return empty array',
    actual: person.names,
    expected: [],
  })
})

test('Person.names - returns empty array when name is null', () => {
  const person = new PersonDocument({ name: null })

  assert({
    given: 'person with null name',
    should: 'return empty array',
    actual: person.names,
    expected: [],
  })
})

test('Person.names - returns array with empty string when name is empty string', () => {
  const person = new PersonDocument({ name: '' })

  assert({
    given: 'person with empty string name',
    should: 'return array with empty string',
    actual: person.names,
    expected: [''],
  })
})

test('Person.names - works with who normalization', () => {
  const person = new PersonDocument({ who: 'John Doe' })

  assert({
    given: 'person created with who field',
    should: 'return array with normalized name',
    actual: person.names,
    expected: ['John Doe'],
  })
})

test('Person.names - works with who array normalization', () => {
  const person = new PersonDocument({ who: ['John Doe', 'Jane Doe', 'Jack Doe'] })

  assert({
    given: 'person created with who array',
    should: 'return array with normalized names',
    actual: person.names,
    expected: ['John Doe', 'Jane Doe', 'Jack Doe'],
  })
})

test('Person.names - returns empty array for non-string non-array name', () => {
  const person = new PersonDocument({ name: 123 })

  assert({
    given: 'person with number as name',
    should: 'return empty array',
    actual: person.names,
    expected: [],
  })
})
