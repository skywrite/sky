import { assert, test } from '#test'
import inferConversationType from './inferConversationType.ts'

test('inferConversationType: C prefix is channel', () => {
  assert({
    given: 'a channel ID starting with C',
    should: 'return channel',
    actual: inferConversationType('C12345678'),
    expected: 'channel',
  })
})

test('inferConversationType: D prefix is dm', () => {
  assert({
    given: 'a channel ID starting with D',
    should: 'return dm',
    actual: inferConversationType('D055G78M5T3'),
    expected: 'dm',
  })
})

test('inferConversationType: G prefix is group', () => {
  assert({
    given: 'a channel ID starting with G',
    should: 'return group',
    actual: inferConversationType('G01234ABCDE'),
    expected: 'group',
  })
})

test('inferConversationType: unknown prefix', () => {
  assert({
    given: 'a channel ID with unexpected prefix',
    should: 'return unknown',
    actual: inferConversationType('X99999'),
    expected: 'unknown',
  })
})
