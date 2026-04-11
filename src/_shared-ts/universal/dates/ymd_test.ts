import { assert, test } from '#test'
import YMD from './ymd.ts'

test(YMD.name, () => {
  assert({
    given: 'a date',
    should: 'return YMD string',
    actual: YMD(new Date(1648372676000)),
    expected: ['2022', '03', '27'],
  })
})
