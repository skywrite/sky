import { assert, test } from '#test'
import { PROJECT_STATUSES } from './mod.ts'

test('PROJECT_STATUSES - contains all valid statuses', () => {
  const expected = ['open', 'hold', 'completed', 'canceled', 'whiteboard']

  expected.forEach((status) => {
    assert({
      given: 'PROJECT_STATUSES constant',
      should: `include ${status}`,
      actual: PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number]),
      expected: true,
    })
  })
})
