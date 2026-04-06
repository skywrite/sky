import { assert, test } from '#test'
import isReleaseDay from './isReleaseDay.ts'

test(isReleaseDay.name, () => {
  const releaseDay = new Date(2022, 9, 20) // 2022-10-20
  const notReleaseDay = new Date(2022, 9, 19) // 2022-10-19

  assert({
    given: 'a release day',
    should: 'return true',
    actual: isReleaseDay(releaseDay),
    expected: true,
  })

  assert({
    given: 'not a release day',
    should: 'return false',
    actual: isReleaseDay(notReleaseDay),
    expected: false,
  })
})
