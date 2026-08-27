import { assert, test } from '#test'
import { isRtf, stampedDurationMinutes, turnStamps } from './plainText.ts'

const FIXTURE = `[0:03] Jane Doe: Thanks for joining, everyone.
[0:07] John Smith: Happy to be here. Should we start with the Atlas rollout?
[1:15] Jane Doe: Yes. The pilot group is on the new build as of Monday.
[1:40] John Smith: Mm-hmm.
[9:41] Jane Doe: Great, let's wrap there. Talk next week.
`

test('turnStamps()', () => {
  assert({
    given: 'm:ss stamped speaker lines',
    should: 'read each line-head stamp as seconds, in order',
    actual: turnStamps(FIXTURE),
    expected: [3, 7, 75, 100, 581],
  })

  assert({
    given: 'an h:mm:ss stamp',
    should: 'count the hours',
    actual: turnStamps('[1:02:03] Jane Doe: One last thing.'),
    expected: [3723],
  })

  assert({
    given: 'minutes past 59 in m:ss form',
    should: 'not cap the minutes',
    actual: turnStamps('[75:30] Jane Doe: Still going.'),
    expected: [4530],
  })

  assert({
    given: 'a stamp mid-line and an unstamped line',
    should: 'skip both',
    actual: turnStamps('Jane Doe: at [0:05] we start\nJohn Smith: sure'),
    expected: [],
  })

  assert({
    given: 'indented and CRLF lines',
    should: 'still match at the line head',
    actual: turnStamps('  [0:10] Jane Doe: a\r\n[0:20] John Smith: b\r\n'),
    expected: [10, 20],
  })
})

test('stampedDurationMinutes()', () => {
  assert({
    given: 'a last turn starting at 9:41',
    should: 'round up to the next whole minute',
    actual: stampedDurationMinutes(turnStamps(FIXTURE)),
    expected: 10,
  })

  assert({
    given: 'a last turn starting exactly on a minute',
    should: 'not add a minute',
    actual: stampedDurationMinutes([0, 540]),
    expected: 9,
  })

  assert({
    given: 'stamps out of order',
    should: 'use the latest, not the last',
    actual: stampedDurationMinutes([600, 30]),
    expected: 10,
  })

  assert({
    given: 'no stamps',
    should: 'be null so the caller falls back to --duration',
    actual: stampedDurationMinutes([]),
    expected: null,
  })
})

test('isRtf()', () => {
  assert({
    given: 'an RTF header',
    should: 'detect it',
    actual: isRtf('{\\rtf1\\ansi\\ansicpg1252 [0:03] Jane Doe: hi}'),
    expected: true,
  })

  assert({
    given: 'whitespace before the header',
    should: 'still detect it',
    actual: isRtf('\n {\\rtf1'),
    expected: true,
  })

  assert({
    given: 'plain speaker lines',
    should: 'not flag them',
    actual: isRtf(FIXTURE),
    expected: false,
  })
})
