import { assert, test } from '#test'
import PersonDocument from '#shared/models/Person/mod.ts'

test('Person.slug - returns lowercase slugified name', () => {
  const person = new PersonDocument({ name: 'John Doe' })

  assert({
    given: 'person with name "John Doe"',
    should: 'return lowercase slug',
    actual: person.slug,
    expected: 'john-doe',
  })
})

test('Person.slug - handles special characters', () => {
  const person = new PersonDocument({ name: "O'Brien & Associates" })

  assert({
    given: 'person with special characters',
    should: 'return slugified version',
    actual: person.slug,
    expected: 'obrien-associates',
  })
})

test('Person.slug - returns empty string when name is empty', () => {
  const person = new PersonDocument({})

  assert({
    given: 'person with no name',
    should: 'return empty string',
    actual: person.slug,
    expected: '',
  })
})

test('Person.slugPreserveCase - preserves case in slug', () => {
  const person = new PersonDocument({ name: 'John Doe' })

  assert({
    given: 'person with name "John Doe"',
    should: 'return slug with preserved case',
    actual: person.slugPreserveCase,
    expected: 'John-Doe',
  })
})

test('Person.slugPreserveCase - preserves case with special characters', () => {
  const person = new PersonDocument({ name: "O'Brien & Associates" })

  assert({
    given: 'person with special characters',
    should: 'return slug with preserved case',
    actual: person.slugPreserveCase,
    expected: 'OBrien-Associates',
  })
})

test('Person.slugPreserveCase - returns empty string when name is empty', () => {
  const person = new PersonDocument({})

  assert({
    given: 'person with no name',
    should: 'return empty string',
    actual: person.slugPreserveCase,
    expected: '',
  })
})

test('Person.slug - works with who normalization', () => {
  const person = new PersonDocument({ who: 'Jane Smith' })

  assert({
    given: 'person created with who field',
    should: 'return lowercase slug from normalized name',
    actual: person.slug,
    expected: 'jane-smith',
  })
})

test('Person.slugPreserveCase - works with who normalization', () => {
  const person = new PersonDocument({ who: 'Jane Smith' })

  assert({
    given: 'person created with who field',
    should: 'return case-preserved slug from normalized name',
    actual: person.slugPreserveCase,
    expected: 'Jane-Smith',
  })
})

test('Person.slug - uses first name from array', () => {
  const person = new PersonDocument({ name: ['John Doe', 'Jane Doe'] })

  assert({
    given: 'person with array of names',
    should: 'return slug of first name',
    actual: person.slug,
    expected: 'john-doe',
  })
})

test('Person.slugPreserveCase - uses first name from array', () => {
  const person = new PersonDocument({ name: ['John Doe', 'Jane Doe'] })

  assert({
    given: 'person with array of names',
    should: 'return case-preserved slug of first name',
    actual: person.slugPreserveCase,
    expected: 'John-Doe',
  })
})
