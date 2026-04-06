import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration.sign - positive', () => {
  assert({ given: '1h', should: 'be 1', actual: new Duration(1).sign, expected: 1 })
})

test('Duration.sign - zero', () => {
  assert({ given: '0', should: 'be 0', actual: new Duration().sign, expected: 0 })
})

test('Duration.sign - negative', () => {
  assert({ given: '-1h', should: 'be -1', actual: new Duration(-1).sign, expected: -1 })
})

test('Duration.blank', () => {
  assert({ given: 'zero duration', should: 'be blank', actual: new Duration().blank, expected: true })
  assert({ given: '1m', should: 'not be blank', actual: new Duration(0, 1).blank, expected: false })
})
