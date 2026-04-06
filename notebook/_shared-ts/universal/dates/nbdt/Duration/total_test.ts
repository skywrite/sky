import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration.total - minutes', () => {
  const d = new Duration(1, 30, 0)
  assert({ given: '1h 30m', should: 'be 90 minutes', actual: d.total('minutes'), expected: 90 })
})

test('Duration.total - hours', () => {
  const d = new Duration(0, 90, 0)
  assert({ given: '90m', should: 'be 1.5 hours', actual: d.total('hours'), expected: 1.5 })
})

test('Duration.total - seconds', () => {
  const d = new Duration(1, 0, 0)
  assert({ given: '1h', should: 'be 3600 seconds', actual: d.total('seconds'), expected: 3600 })
})
