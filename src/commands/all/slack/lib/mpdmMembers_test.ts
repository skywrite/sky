import { assert, test } from '#test'
import { mpdmMemberHandles } from './mpdmMembers.ts'

test('mpdmMemberHandles parses group-DM slugs', () => {
  assert({
    given: 'an mpdm slug with a numeric suffix',
    should: 'split the handles',
    actual: mpdmMemberHandles('mpdm-alice--bob.smith--carol-1'),
    expected: ['alice', 'bob.smith', 'carol'],
  })
  assert({
    given: 'a leading # and multi-digit suffix',
    should: 'still parse',
    actual: mpdmMemberHandles('#mpdm-alice--bob-12'),
    expected: ['alice', 'bob'],
  })
})

test('mpdmMemberHandles rejects non-mpdm names', () => {
  assert({
    given: 'a regular channel',
    should: 'return empty',
    actual: mpdmMemberHandles('atlas-rollout'),
    expected: [],
  })
  assert({ given: 'undefined', should: 'return empty', actual: mpdmMemberHandles(undefined), expected: [] })
})
