import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration.add', () => {
  const a = new Duration(1, 0, 0)
  const b = new Duration(0, 30, 0)
  const sum = a.add(b)
  assert({ given: '1h + 30m', should: 'total 90m', actual: sum.total('minutes'), expected: 90 })
})

test('Duration.subtract', () => {
  const a = new Duration(2, 0, 0)
  const b = new Duration(0, 30, 0)
  const diff = a.subtract(b)
  assert({ given: '2h - 30m', should: 'total 90m', actual: diff.total('minutes'), expected: 90 })
})

test('Duration.negated', () => {
  const d = new Duration(1, 30, 0).negated()
  assert({ given: '1h30m negated', should: 'have -1h', actual: d.hours, expected: -1 })
  assert({ given: '1h30m negated', should: 'have -30m', actual: d.minutes, expected: -30 })
})

test('Duration.abs', () => {
  const d = new Duration(-1, -30, 0).abs()
  assert({ given: '-1h -30m abs', should: 'have 1h', actual: d.hours, expected: 1 })
  assert({ given: '-1h -30m abs', should: 'have 30m', actual: d.minutes, expected: 30 })
})
