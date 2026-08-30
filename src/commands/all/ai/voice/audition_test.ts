import { assert, test } from '#test'
import { auditionUrl } from './audition.ts'

test({ name: 'ai:voice:audition - the URL carries the passage only when there is one' }, () => {
  assert({
    given: 'no passage',
    should: 'open the bare page',
    actual: auditionUrl(9999),
    expected: 'http://localhost:9999/voice/audition',
  })
  assert({
    given: 'a blank passage',
    should: 'open the bare page too',
    actual: auditionUrl(9999, '   '),
    expected: 'http://localhost:9999/voice/audition',
  })
  assert({
    given: 'a passage',
    should: 'carry it trimmed and encoded',
    actual: auditionUrl(9999, ' Hey Jane, ready? '),
    expected: 'http://localhost:9999/voice/audition?passage=Hey+Jane%2C+ready%3F',
  })
})
