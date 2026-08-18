import { assert, test } from '#test'
import hasEndOrLength from './hasEndOrLength.ts'

test(`hasEndOrLength() with a range`, () => {
  const given = 'a when value with an end time'
  const should = 'return true'
  assert({ given, should, actual: hasEndOrLength('2026-03-10 15:45 - 16:30'), expected: true })
})

test(`hasEndOrLength() with a minutes length`, () => {
  const given = 'a when value with a minutes length'
  const should = 'return true'
  assert({ given, should, actual: hasEndOrLength('2026-03-06 08:00 20m'), expected: true })
})

test(`hasEndOrLength() with an hours length`, () => {
  const given = 'a when value with a fractional hours length'
  const should = 'return true'
  assert({ given, should, actual: hasEndOrLength('2026-03-06 08:00 1.5h'), expected: true })
})

test(`hasEndOrLength() with a bare start`, () => {
  const given = 'a start-only when value'
  const should = 'return false'
  assert({ given, should, actual: hasEndOrLength('2026-03-10 15:45'), expected: false })
})

test(`hasEndOrLength() with extended hours`, () => {
  const given = 'a start-only late-night when value (25:30)'
  const should = 'return false - the extended hour is not a length'
  assert({ given, should, actual: hasEndOrLength('2026-03-10 25:30'), expected: false })
})
