import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { parseCsv } from './parseCsv.ts'

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

async function readFixture(name: string): Promise<string> {
  return readTextFile(`${FIXTURES_DIR}${name}`)
}

test('parseCsv: basic parsing', () => {
  const FIXTURES = [
    {
      name: 'simple two-column CSV',
      input: `name,age
Alice,30
Bob,25`,
      expected: {
        header: ['name', 'age'],
        records: [
          { name: 'Alice', age: '30' },
          { name: 'Bob', age: '25' },
        ],
      },
    },
    {
      name: 'single row',
      input: `name,age
Alice,30`,
      expected: {
        header: ['name', 'age'],
        records: [{ name: 'Alice', age: '30' }],
      },
    },
    {
      name: 'header only',
      input: `name,age`,
      expected: {
        header: ['name', 'age'],
        records: [],
      },
    },
    {
      name: 'empty input',
      input: '',
      expected: {
        header: [],
        records: [],
      },
    },
    {
      name: 'whitespace only',
      input: '   \n  ',
      expected: {
        header: [],
        records: [],
      },
    },
  ]

  FIXTURES.forEach(({ name, input, expected }) => {
    assert({
      given: name,
      should: 'parse correctly',
      actual: parseCsv(input),
      expected,
    })
  })
})

test('parseCsv: quoted fields', () => {
  const FIXTURES = [
    {
      name: 'quoted values',
      input: `"name","age"
"Alice","30"`,
      expected: {
        header: ['name', 'age'],
        records: [{ name: 'Alice', age: '30' }],
      },
    },
    {
      name: 'mixed quoted and unquoted',
      input: `name,"age"
"Alice",30`,
      expected: {
        header: ['name', 'age'],
        records: [{ name: 'Alice', age: '30' }],
      },
    },
  ]

  FIXTURES.forEach(({ name, input, expected }) => {
    assert({
      given: name,
      should: 'strip quotes',
      actual: parseCsv(input),
      expected,
    })
  })
})

test('parseCsv: whitespace handling', () => {
  const FIXTURES = [
    {
      name: 'whitespace around values',
      input: `name , age
 Alice , 30 `,
      expected: {
        header: ['name', 'age'],
        records: [{ name: 'Alice', age: '30' }],
      },
    },
    {
      name: 'trailing newline',
      input: `name,age
Alice,30
`,
      expected: {
        header: ['name', 'age'],
        records: [{ name: 'Alice', age: '30' }],
      },
    },
  ]

  FIXTURES.forEach(({ name, input, expected }) => {
    assert({
      given: name,
      should: 'trim whitespace',
      actual: parseCsv(input),
      expected,
    })
  })
})

test('parseCsv: empty and special values', () => {
  const FIXTURES = [
    {
      name: 'empty field values',
      input: `name,age
,30
Alice,`,
      expected: {
        header: ['name', 'age'],
        records: [
          { name: '', age: '30' },
          { name: 'Alice', age: '' },
        ],
      },
    },
    {
      name: 'dash for missing data',
      input: `day,value
M,-
T,100`,
      expected: {
        header: ['day', 'value'],
        records: [
          { day: 'M', value: '-' },
          { day: 'T', value: '100' },
        ],
      },
    },
  ]

  FIXTURES.forEach(({ name, input, expected }) => {
    assert({
      given: name,
      should: 'preserve empty and special values as strings',
      actual: parseCsv(input),
      expected,
    })
  })
})

test('parseCsv: hasHeader option', () => {
  const input = `Alice,30
Bob,25`

  assert({
    given: 'hasHeader: false',
    should: 'return records with numeric keys',
    actual: parseCsv(input, { hasHeader: false }),
    expected: {
      header: [],
      records: [
        { '0': 'Alice', '1': '30' },
        { '0': 'Bob', '1': '25' },
      ],
    },
  })
})

test('parseCsv: fixture file - basic.csv', async () => {
  const csv = await readFixture('basic.csv')
  const result = parseCsv(csv)

  assert({
    given: 'basic.csv fixture',
    should: 'parse header',
    actual: result.header,
    expected: ['name', 'age'],
  })

  assert({
    given: 'basic.csv fixture',
    should: 'parse records',
    actual: result.records.length,
    expected: 2,
  })
})

test('parseCsv: fixture file - tracking-sleep.csv', async () => {
  const csv = await readFixture('tracking-sleep.csv')
  const result = parseCsv(csv)

  assert({
    given: 'tracking-sleep.csv fixture',
    should: 'parse header with spaces',
    actual: result.header,
    expected: ['day', 'range', 'duration (hrs)', 'notes'],
  })

  assert({
    given: 'tracking-sleep.csv first record',
    should: 'parse quoted time range',
    actual: result.records[0],
    expected: { day: 'M', range: '22:30-6:30', 'duration (hrs)': '8', notes: '-' },
  })

  assert({
    given: 'tracking-sleep.csv third record',
    should: 'handle commas inside quotes',
    actual: result.records[2].notes,
    expected: 'woke up once, fell back asleep',
  })
})
