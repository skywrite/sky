import { RESPONSE_MARK_HOURS, RESPONSE_POINTS } from '#lib/needsResponse/marks.ts'
import { assert, test } from '#test'
import { MARK_NAMES, MARK_NAMES_SHORT, WAIT_GROUPS } from './markNames.ts'

test('the names on screen follow the marks the score is graded by', () => {
  // "1 day" names the 24-hour mark and "3 days" the 72-hour one.
  const hoursNamed = (name: string) => Number.parseInt(name, 10) * (name.includes('day') ? 24 : 1)

  assert({
    given: 'the marks and the points behind the score',
    should: 'have one name per mark, in both lengths, and one group per points step',
    actual: {
      names: MARK_NAMES.map(hoursNamed),
      short: MARK_NAMES_SHORT.map(hoursNamed),
      groups: WAIT_GROUPS.length,
    },
    expected: {
      names: [...RESPONSE_MARK_HOURS],
      short: [...RESPONSE_MARK_HOURS],
      groups: RESPONSE_POINTS.length,
    },
  })
})
