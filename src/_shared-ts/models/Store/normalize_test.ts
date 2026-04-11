import { assert, test } from '#test'
import { normalizeName } from './normalize.ts'

const fixtures = [
  {
    description: 'lowercase conversion',
    input: 'John Doe',
    expected: 'john doe',
  },
  {
    description: 'trim leading whitespace',
    input: '  Jane Smith',
    expected: 'jane smith',
  },
  {
    description: 'trim trailing whitespace',
    input: 'Bob Wilson  ',
    expected: 'bob wilson',
  },
  {
    description: 'collapse multiple spaces',
    input: 'Alice    Cooper',
    expected: 'alice cooper',
  },
  {
    description: 'handle tabs as whitespace',
    input: 'Test\t\tName',
    expected: 'test name',
  },
  {
    description: 'preserve accented characters',
    input: 'Sebastián Martínez',
    expected: 'sebastián martínez',
  },
  {
    description: 'empty string',
    input: '',
    expected: '',
  },
  {
    description: 'only whitespace',
    input: '   ',
    expected: '',
  },
  {
    description: 'mixed case with numbers',
    input: 'Test123 User',
    expected: 'test123 user',
  },
]

fixtures.forEach((fixture) => {
  test(`normalizeName - ${fixture.description}`, () => {
    assert({
      given: fixture.input ? `"${fixture.input}"` : 'empty string',
      should: `return "${fixture.expected}"`,
      actual: normalizeName(fixture.input),
      expected: fixture.expected,
    })
  })
})
