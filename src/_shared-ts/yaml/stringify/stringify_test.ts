import { assert, test } from '#test'
import { readTextFile } from '#shared/fs/mod.ts'
import stringify from './mod.ts'

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

interface KeyOrderFixture {
  name: string
  keyOrder: string[]
}

const keyOrderFixtures: KeyOrderFixture[] = [
  { name: 'basic', keyOrder: ['name', 'created', 'updated', 'tags'] },
  { name: 'missing-keys', keyOrder: ['title', 'name', 'created', 'tags'] },
  { name: 'extra-keys', keyOrder: ['name', 'created'] },
  { name: 'nested', keyOrder: ['name', 'meta'] },
  { name: 'frontmatter', keyOrder: ['title', 'created', 'updated', 'tags', 'rel'] },
]

test('stringify - basic object', () => {
  const obj = {
    name: 'John Doe',
    age: 30,
    email: 'john@example.com',
  }

  assert({
    given: 'a basic object',
    should: 'stringify to YAML',
    actual: stringify(obj),
    expected: `name: John Doe
age: 30
email: john@example.com`,
  })
})

test('stringify - null values', () => {
  const obj = {
    name: 'John',
    email: null,
    phone: null,
  }

  assert({
    given: 'object with null values',
    should: 'render nulls as empty',
    actual: stringify(obj),
    expected: `name: John
email:
phone:`,
  })
})

test('stringify - arrays', () => {
  const obj = {
    tags: ['work', 'important', 'todo'],
    categories: [],
  }

  assert({
    given: 'object with arrays',
    should: 'render arrays properly',
    actual: stringify(obj),
    expected: `tags:
  - work
  - important
  - todo
categories: []`,
  })
})

test('stringify - nested objects', () => {
  const obj = {
    person: {
      name: 'Jane',
      contact: {
        email: 'jane@example.com',
        phone: '555-1234',
      },
    },
  }

  assert({
    given: 'nested objects',
    should: 'render with proper indentation',
    actual: stringify(obj),
    expected: `person:
  name: Jane
  contact:
    email: jane@example.com
    phone: 555-1234`,
  })
})

test('stringify - special characters and multiline', () => {
  const obj = {
    description: 'This has "quotes" and \'apostrophes\'',
    multiline: 'Line 1\nLine 2\nLine 3',
  }

  const result = stringify(obj)

  assert({
    given: 'string with special characters',
    should: 'include description key',
    actual: result.includes('description:'),
    expected: true,
  })

  assert({
    given: 'multiline string',
    should: 'include multiline key',
    actual: result.includes('multiline:'),
    expected: true,
  })
})

test('stringify - empty object', () => {
  assert({
    given: 'empty object',
    should: 'return {}',
    actual: stringify({}),
    expected: '{}',
  })
})

test('stringify - complex Person YAML', () => {
  const person = {
    name: 'John Smith',
    alt: null,
    email: {
      personal: 'john@personal.com',
      business: null,
    },
    title: 'Software Engineer',
    org: 'Acme Corp',
    location: 'New York',
    met: '2025-07-15',
    tags: ['colleague', 'friend'],
  }

  assert({
    given: 'complex person object',
    should: 'stringify all fields correctly',
    actual: stringify(person),
    expected: `name: John Smith
alt:
email:
  personal: john@personal.com
  business:
title: Software Engineer
org: Acme Corp
location: New York
met: 2025-07-15
tags:
  - colleague
  - friend`,
  })
})

test('stringify - numeric strings are quoted', () => {
  const obj = {
    simple: 'value',
    number: '123',
    date: '2025-07-31',
  }

  const result = stringify(obj)

  assert({
    given: 'numeric string value',
    should: 'be quoted',
    actual: result.includes('number: "123"'),
    expected: true,
  })

  assert({
    given: 'date string value',
    should: 'not be quoted',
    actual: result.includes('date: 2025-07-31'),
    expected: true,
  })
})

test('stringify - markdown frontmatter dates unquoted', () => {
  const frontmatter = {
    created: '2025-10-19',
    updated: '2025-10-19T14:30:00',
    name: 'test-project',
    tags: ['work', 'important'],
  }

  const result = stringify(frontmatter)

  assert({
    given: 'frontmatter with dates',
    should: 'stringify correctly',
    actual: result,
    expected: `created: 2025-10-19
updated: 2025-10-19T14:30:00
name: test-project
tags:
  - work
  - important`,
  })

  assert({
    given: 'date value',
    should: 'not have double quotes',
    actual: result.includes('"2025-10-19"'),
    expected: false,
  })

  assert({
    given: 'date value',
    should: 'not have single quotes',
    actual: result.includes("'2025-10-19'"),
    expected: false,
  })
})

// keyOrder tests using fixture files
keyOrderFixtures.forEach((fixture) => {
  test(`stringify keyOrder - ${fixture.name}`, async () => {
    const inputJson = await readTextFile(`${FIXTURES_DIR}keyOrder-${fixture.name}.input.json`)
    const expectedYaml = await readTextFile(`${FIXTURES_DIR}keyOrder-${fixture.name}.expected.yaml`)

    const input = JSON.parse(inputJson)
    const result = stringify(input, { keyOrder: fixture.keyOrder })

    assert({
      given: `keyOrder-${fixture.name} fixture`,
      should: 'produce expected YAML output',
      actual: result,
      expected: expectedYaml.trimEnd(),
    })
  })
})
