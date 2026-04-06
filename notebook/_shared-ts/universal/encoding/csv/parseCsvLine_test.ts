import { assert, test } from '#test'
import { parseCsvLine } from './parseCsvLine.ts'

test('parseCsvLine: basic parsing', () => {
  const FIXTURES = [
    { input: 'a,b,c', expected: ['a', 'b', 'c'] },
    { input: 'hello,world', expected: ['hello', 'world'] },
    { input: 'single', expected: ['single'] },
    { input: '', expected: [''] },
    { input: ',', expected: ['', ''] },
    { input: ',,', expected: ['', '', ''] },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `basic input: "${input}"`,
      should: 'split on commas',
      actual: parseCsvLine(input),
      expected,
    })
  })
})

test('parseCsvLine: quoted fields', () => {
  const FIXTURES = [
    { input: '"a","b"', expected: ['a', 'b'] },
    { input: '"hello,world",foo', expected: ['hello,world', 'foo'] },
    { input: 'foo,"hello,world"', expected: ['foo', 'hello,world'] },
    { input: '"a,b","c,d"', expected: ['a,b', 'c,d'] },
    { input: '"",""', expected: ['', ''] },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `quoted input: "${input}"`,
      should: 'preserve commas inside quotes',
      actual: parseCsvLine(input),
      expected,
    })
  })
})

test('parseCsvLine: escaped quotes', () => {
  const FIXTURES = [
    { input: '"say ""hello"""', expected: ['say "hello"'] },
    { input: '"""quoted"""', expected: ['"quoted"'] },
    { input: '"a""b""c"', expected: ['a"b"c'] },
    { input: '"he said ""hi"", then left"', expected: ['he said "hi", then left'] },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `escaped quotes: "${input}"`,
      should: 'unescape double quotes',
      actual: parseCsvLine(input),
      expected,
    })
  })
})

test('parseCsvLine: whitespace handling', () => {
  const FIXTURES = [
    { input: ' a , b , c ', expected: ['a', 'b', 'c'] },
    { input: '  hello  ,  world  ', expected: ['hello', 'world'] },
    { input: '"  spaces  ",trimmed', expected: ['  spaces  ', 'trimmed'] },
    { input: ' "quoted" , "also" ', expected: ['quoted', 'also'] },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `whitespace: "${input}"`,
      should: 'trim outside quotes, preserve inside',
      actual: parseCsvLine(input),
      expected,
    })
  })
})

test('parseCsvLine: mixed fields', () => {
  const FIXTURES = [
    { input: 'plain,"quoted",plain', expected: ['plain', 'quoted', 'plain'] },
    { input: '"with,comma",no-comma,"more,commas"', expected: ['with,comma', 'no-comma', 'more,commas'] },
    { input: '1,"hello, world",3', expected: ['1', 'hello, world', '3'] },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `mixed: "${input}"`,
      should: 'handle mixed quoted/unquoted',
      actual: parseCsvLine(input),
      expected,
    })
  })
})

test('parseCsvLine: tracking CSV examples', () => {
  const FIXTURES = [
    {
      input: 'M, "22:30-6:30", 8, -',
      expected: ['M', '22:30-6:30', '8', '-'],
    },
    {
      input: 'day, range, duration (hrs), notes',
      expected: ['day', 'range', 'duration (hrs)', 'notes'],
    },
    {
      input: 'T, "23:00-7:00", 8, "slept well, felt rested"',
      expected: ['T', '23:00-7:00', '8', 'slept well, felt rested'],
    },
  ]

  FIXTURES.forEach(({ input, expected }) => {
    assert({
      given: `tracking CSV: "${input}"`,
      should: 'parse correctly',
      actual: parseCsvLine(input),
      expected,
    })
  })
})
