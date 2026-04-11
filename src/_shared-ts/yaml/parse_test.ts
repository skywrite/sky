import { assert, loadFixturesSync, test } from '#test'
import { parse as parseYAML } from './parse.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

const testCases = [
  {
    file: 'simple-string',
    should: 'Return a string',
    given: 'A simple string input',
  },
  {
    file: 'simple-array',
    should: 'Return an array of strings',
    given: 'A simple array input',
  },
  {
    file: 'simple-object',
    should: 'Return an object with string values',
    given: 'A simple object input',
  },
  {
    file: 'nested-object',
    should: 'Return a nested object structure',
    given: 'A nested object input',
  },
  {
    file: 'array-of-objects',
    should: 'Return an array of objects',
    given: 'An array of objects input',
  },
  {
    file: 'mixed-types',
    should: 'Return a complex structure with strings, arrays, and objects',
    given: 'A mixed type input with strings, arrays, and objects',
  },
  {
    file: 'string-folding',
    should: 'Return the string without new lines',
    given: 'A folded string',
  },
  {
    file: 'string-block',
    should: 'Return the string with new lines',
    given: 'A block string',
  },
]

for (const { file, should, given } of testCases) {
  test(`parseYAML(): ${file}`, () => {
    const input = FIXTURES[`${file}.yaml`]
    const expected = JSON.parse(FIXTURES[`${file}.json`])
    const actual = parseYAML(input)
    assert({ given, should, expected, actual })
  })
}
