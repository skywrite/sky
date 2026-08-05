import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

test(`${DayDocument.name}.toString()`, () => {
  const day = new DayDocument({ day: PlainDate.from('2022-07-03') })

  assert({
    actual: day.toString(),
    expected: 'DayDocument<2022-07-03>',
  })
})
