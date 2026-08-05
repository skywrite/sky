import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

const FIXTURES: [string, boolean][] = [
  ['~~Ask Sam about Alice reporting to Jane~~', true],
  ['18:00 > ~~projects/Daily-Spanish -> Do lesson~~', true],
  ['09:00 > Go to the super market', false],
  ['23:00 > ~~Go to the super market~~', true],
  ['Do my laundry', false],
  ['~~Do my laundry~~', true],
]

test(`${DayDocument.name}#isItemDone()`, () => {
  for (const [task, status] of FIXTURES) {
    assert({
      given: `Task: ${task}}`,
      should: `Should return ${status}`,
      expected: status,
      actual: DayDocument.isItemDone(task),
    })
  }
})
