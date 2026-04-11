import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration constructor - defaults to zero', () => {
  const d = new Duration()
  assert({ given: 'no args', should: 'have 0 hours', actual: d.hours, expected: 0 })
  assert({ given: 'no args', should: 'have 0 minutes', actual: d.minutes, expected: 0 })
  assert({ given: 'no args', should: 'have 0 seconds', actual: d.seconds, expected: 0 })
})

test('Duration constructor - stores values', () => {
  const d = new Duration(1, 30, 15)
  assert({ given: '1,30,15', should: 'store hours', actual: d.hours, expected: 1 })
  assert({ given: '1,30,15', should: 'store minutes', actual: d.minutes, expected: 30 })
  assert({ given: '1,30,15', should: 'store seconds', actual: d.seconds, expected: 15 })
})

test('Duration constructor - rejects non-integer', () => {
  let threw = false
  try {
    new Duration(1.5)
  } catch {
    threw = true
  }
  assert({ given: 'fractional hours', should: 'throw', actual: threw, expected: true })
})

test('Duration constructor - rejects NaN', () => {
  let threw = false
  try {
    new Duration(NaN)
  } catch {
    threw = true
  }
  assert({ given: 'NaN hours', should: 'throw', actual: threw, expected: true })
})
