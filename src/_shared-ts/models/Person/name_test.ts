import PersonDocument from '#shared/models/Person/mod.ts'
import { assert, test } from '#test'

test('Person.name - returns first name when name is string', () => {
  const person = new PersonDocument({ name: 'John Doe' })

  assert({
    given: 'person with string name',
    should: 'return the name',
    actual: person.name,
    expected: 'John Doe',
  })
})

test('Person.name - returns first name when name is array', () => {
  const person = new PersonDocument({ name: ['John Doe', 'Jane Doe'] })

  assert({
    given: 'person with array of names',
    should: 'return first name',
    actual: person.name,
    expected: 'John Doe',
  })
})

test('Person.name - returns empty string when name is missing', () => {
  const person = new PersonDocument({})

  assert({
    given: 'person with no name',
    should: 'return empty string',
    actual: person.name,
    expected: '',
  })
})

test('Person.name - returns empty string when name is null', () => {
  const person = new PersonDocument({ name: null })

  assert({
    given: 'person with null name',
    should: 'return empty string',
    actual: person.name,
    expected: '',
  })
})

test('Person.name - returns empty string when name is empty array', () => {
  const person = new PersonDocument({ name: [] })

  assert({
    given: 'person with empty array name',
    should: 'return empty string',
    actual: person.name,
    expected: '',
  })
})

test('Person.name - returns empty string when name is empty string', () => {
  const person = new PersonDocument({ name: '' })

  assert({
    given: 'person with empty string name',
    should: 'return empty string (first item of names array)',
    actual: person.name,
    expected: '',
  })
})

test('Person.name - works with who normalization', () => {
  const person = new PersonDocument({ who: 'John Doe' })

  assert({
    given: 'person created with who field',
    should: 'return normalized name',
    actual: person.name,
    expected: 'John Doe',
  })
})

test('Person.name - returns first name from who array', () => {
  const person = new PersonDocument({ who: ['John Doe', 'Jane Doe', 'Jack Doe'] })

  assert({
    given: 'person created with who array',
    should: 'return first name from array',
    actual: person.name,
    expected: 'John Doe',
  })
})

test('Person.name - returns empty string for invalid types', () => {
  const person = new PersonDocument({ name: 123 })

  assert({
    given: 'person with number as name',
    should: 'return empty string',
    actual: person.name,
    expected: '',
  })
})
