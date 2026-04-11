import { assert, test } from '#test'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

test(`${DayDocument.name}.YMD`, () => {
  const day = new DayDocument({ day: PlainDate.from('2022-07-03') })

  assert({
    actual: day.YMD,
    expected: '2022-07-03',
  })
})
