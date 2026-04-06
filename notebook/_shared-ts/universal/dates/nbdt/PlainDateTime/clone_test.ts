import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

test('PlainDateTime.clone()', () => {
  const fixture = '2025-07-23 09:42'
  const dt = PlainDateTime.fromString(fixture)
  const dtClone = dt.clone()

  assert({
    given: `a PlainDateTime`,
    should: `return an exact clone`,
    actual: dtClone.toString(),
    expected: fixture,
  })

  assert({
    given: `a PlainDateTime`,
    should: `ensure different instance`,
    actual: dt !== dtClone,
    expected: true,
  })
})
