import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration.balanced - 90 minutes', () => {
  const d = new Duration(0, 90, 0).balanced()
  assert({ given: '90m', should: 'balance to 1h', actual: d.hours, expected: 1 })
  assert({ given: '90m', should: 'balance to 30m', actual: d.minutes, expected: 30 })
  assert({ given: '90m', should: 'balance to 0s', actual: d.seconds, expected: 0 })
})

test('Duration.balanced - 3661 seconds', () => {
  const d = new Duration(0, 0, 3661).balanced()
  assert({ given: '3661s', should: 'balance to 1h', actual: d.hours, expected: 1 })
  assert({ given: '3661s', should: 'balance to 1m', actual: d.minutes, expected: 1 })
  assert({ given: '3661s', should: 'balance to 1s', actual: d.seconds, expected: 1 })
})
