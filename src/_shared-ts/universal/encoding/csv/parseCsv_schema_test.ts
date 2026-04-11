import { assert, test } from '#test'
import { readTextFile } from '#shared/fs/mod.ts'
import { z } from 'zod'
import { parseCsv } from './parseCsv.ts'

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

async function readFixture(name: string): Promise<string> {
  return readTextFile(`${FIXTURES_DIR}${name}`)
}

test('parseCsv schema: coerce.number', () => {
  const schema = z.object({
    name: z.string(),
    age: z.coerce.number(),
  })

  const input = `name,age
Alice,30
Bob,25`

  const result = parseCsv(input, { schema })

  assert({
    given: 'CSV with numeric column and coerce schema',
    should: 'return typed records with numbers',
    actual: result.records,
    expected: [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ],
  })
})

test('parseCsv schema: multiple type coercions', () => {
  const schema = z.object({
    day: z.string(),
    weight: z.coerce.number(),
    notes: z.string(),
  })

  const input = `day,weight,notes
M,150.5,morning
T,151.2,after lunch`

  const result = parseCsv(input, { schema })

  assert({
    given: 'CSV with float values',
    should: 'parse floats correctly',
    actual: result.records[0].weight,
    expected: 150.5,
  })

  assert({
    given: 'schema result',
    should: 'have correct types',
    actual: typeof result.records[0].weight,
    expected: 'number',
  })
})

test('parseCsv schema: optional fields', () => {
  const schema = z.object({
    name: z.string(),
    age: z.coerce.number(),
    notes: z.string().optional(),
  })

  const input = `name,age,notes
Alice,30,
Bob,25,some note`

  const result = parseCsv(input, { schema })

  assert({
    given: 'CSV with optional field empty',
    should: 'parse successfully',
    actual: result.records[0],
    expected: { name: 'Alice', age: 30, notes: '' },
  })
})

test('parseCsv schema: validation error', () => {
  const schema = z.object({
    name: z.string(),
    age: z.coerce.number().min(0),
  })

  const input = `name,age
Alice,not-a-number`

  let errorThrown = false
  let errorMessage = ''

  try {
    parseCsv(input, { schema })
  } catch (error) {
    errorThrown = true
    errorMessage = (error as Error).message
  }

  assert({
    given: 'CSV with invalid data for schema',
    should: 'throw an error',
    actual: errorThrown,
    expected: true,
  })

  assert({
    given: 'error message',
    should: 'include line number',
    actual: errorMessage.includes('line 2'),
    expected: true,
  })
})

test('parseCsv schema: boolean coercion', () => {
  const schema = z.object({
    name: z.string(),
    active: z.preprocess((v) => v === 'true' || v === '1', z.boolean()),
  })

  const input = `name,active
Alice,true
Bob,false`

  const result = parseCsv(input, { schema })

  assert({
    given: 'CSV with boolean-like strings',
    should: 'coerce to booleans',
    actual: result.records,
    expected: [
      { name: 'Alice', active: true },
      { name: 'Bob', active: false },
    ],
  })
})

test('parseCsv schema: fixture file - weight.csv', async () => {
  const schema = z.object({
    day: z.string(),
    weight: z.coerce.number(),
    notes: z.string(),
  })

  const csv = await readFixture('weight.csv')
  const result = parseCsv(csv, { schema })

  assert({
    given: 'weight.csv with schema',
    should: 'parse weights as numbers',
    actual: result.records[0].weight,
    expected: 150.5,
  })

  assert({
    given: 'weight.csv records',
    should: 'have correct count',
    actual: result.records.length,
    expected: 3,
  })
})

test('parseCsv schema: fixture file - people.csv', async () => {
  const schema = z.object({
    name: z.string(),
    age: z.coerce.number(),
    active: z.preprocess((v) => v === 'true', z.boolean()),
  })

  const csv = await readFixture('people.csv')
  const result = parseCsv(csv, { schema })

  assert({
    given: 'people.csv with full schema',
    should: 'parse all types correctly',
    actual: result.records[0],
    expected: { name: 'Alice', age: 30, active: true },
  })

  assert({
    given: 'people.csv second record',
    should: 'parse false boolean',
    actual: result.records[1].active,
    expected: false,
  })
})
