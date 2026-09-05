import { assert, test } from '#test'
import { instantNow } from './mod.ts'

test('instantNow retains UTC seconds and milliseconds', () => {
  assert({
    given: 'a real wall-clock observation',
    should: 'include an explicit UTC zone and three fractional second digits',
    actual: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instantNow()),
    expected: true,
  })
})
