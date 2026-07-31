import { assert, test } from '#test'
import { csvToValues } from './csv.ts'

test('csvToValues', () => {
  assert({
    given: 'csv with quotes, embedded commas, and numbers',
    should: 'produce rows with plain numerics coerced',
    expected: [
      ['Month', 'Spend', 'Note'],
      ['Jan', 1200, 'kickoff, phase 1'],
      ['Feb', 980.5, 'says "steady"'],
    ],
    actual: csvToValues(['Month,Spend,Note', 'Jan,1200,"kickoff, phase 1"', 'Feb,980.5,"says ""steady"""'].join('\n')),
  })

  assert({
    given: 'CRLF line endings and blank lines',
    should: 'skip empties and split correctly',
    expected: [
      ['a', 'b'],
      [1, 2],
    ],
    actual: csvToValues('a,b\r\n\r\n1,2\r\n'),
  })

  assert({
    given: 'formatted and negative values',
    should: 'coerce plain numerics only; formatted ones stay strings for USER_ENTERED parsing',
    expected: [['$1,200', '12%', -42, '2026-07-29']],
    actual: csvToValues('"$1,200",12%,-42,2026-07-29'),
  })
})
