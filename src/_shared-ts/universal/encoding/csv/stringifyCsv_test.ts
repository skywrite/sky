import { assert, test } from '#test'
import { parseCsv } from './parseCsv.ts'
import { stringifyCsv } from './stringifyCsv.ts'

test('stringifyCsv: basic stringify', () => {
  const FIXTURES = [
    {
      name: 'simple two-column CSV',
      records: [
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '25' },
      ],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,30\nBob,25\n',
    },
    {
      name: 'single record',
      records: [{ name: 'Alice', age: '30' }],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,30\n',
    },
    {
      name: 'empty records',
      records: [],
      columns: ['name', 'age'],
      expected: 'name,age\n',
    },
  ]

  FIXTURES.forEach(({ name, records, columns, expected }) => {
    assert({
      given: name,
      should: 'stringify correctly',
      actual: stringifyCsv(records, columns),
      expected,
    })
  })
})

test('stringifyCsv: quoting', () => {
  const FIXTURES = [
    {
      name: 'value with comma',
      records: [{ note: 'hello, world', val: '1' }],
      columns: ['note', 'val'],
      expected: 'note,val\n"hello, world",1\n',
    },
    {
      name: 'value with double quote',
      records: [{ note: 'say "hi"', val: '1' }],
      columns: ['note', 'val'],
      expected: 'note,val\n"say ""hi""",1\n',
    },
    {
      name: 'value with newline',
      records: [{ note: 'line1\nline2', val: '1' }],
      columns: ['note', 'val'],
      expected: 'note,val\n"line1\nline2",1\n',
    },
  ]

  FIXTURES.forEach(({ name, records, columns, expected }) => {
    assert({
      given: name,
      should: 'quote correctly',
      actual: stringifyCsv(records, columns),
      expected,
    })
  })
})

test('stringifyCsv: empty and non-string values', () => {
  const FIXTURES = [
    {
      name: 'undefined value',
      records: [{ name: 'Alice', age: undefined }],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,\n',
    },
    {
      name: 'null value',
      records: [{ name: 'Alice', age: null }],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,\n',
    },
    {
      name: 'numeric value',
      records: [{ name: 'Alice', age: 30 }],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,30\n',
    },
    {
      name: 'missing key',
      records: [{ name: 'Alice' }],
      columns: ['name', 'age'],
      expected: 'name,age\nAlice,\n',
    },
  ]

  FIXTURES.forEach(({ name, records, columns, expected }) => {
    assert({
      given: name,
      should: 'handle correctly',
      actual: stringifyCsv(records, columns),
      expected,
    })
  })
})

test('stringifyCsv: column ordering', () => {
  assert({
    given: 'columns in different order than record keys',
    should: 'output values in column order',
    actual: stringifyCsv([{ b: '2', a: '1' }], ['a', 'b']),
    expected: 'a,b\n1,2\n',
  })
})

test('stringifyCsv + parseCsv: round-trip', () => {
  const original = [
    { name: 'Alice', age: '30', city: 'NYC' },
    { name: 'Bob', age: '25', city: 'LA' },
  ]
  const columns = ['name', 'age', 'city']

  const csv = stringifyCsv(original, columns)
  const { records } = parseCsv(csv)

  assert({
    given: 'round-trip through stringify then parse',
    should: 'return identical records',
    actual: records,
    expected: original,
  })
})

test('stringifyCsv + parseCsv: round-trip with quoted values', () => {
  const original = [{ name: "O'Brien", note: 'said "hello, world"' }]
  const columns = ['name', 'note']

  const csv = stringifyCsv(original, columns)
  const { records } = parseCsv(csv)

  assert({
    given: 'round-trip with quotes and commas',
    should: 'preserve values exactly',
    actual: records,
    expected: original,
  })
})
