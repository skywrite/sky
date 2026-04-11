import { assert, test } from '#test'
import clone from './clone.ts'

test(clone.name, () => {
  const fixture = new Date()
  const clonedDate = clone(fixture)

  assert({
    given: 'a date',
    should: 'clone with a new instance but have the same value',
    actual: clonedDate.getTime(),
    expected: fixture.getTime(),
  })

  assert({
    given: 'a date',
    should: 'clone with a new instance but have different reference',
    actual: false,
    expected: clonedDate === fixture,
  })
})
