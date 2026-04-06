import { assert, test } from '#test'
import formatChannelLabel from './formatChannelLabel.ts'

test('formatChannelLabel: channel with name', () => {
  assert({
    given: 'a channel with a name',
    should: 'prefix with # and include type label',
    actual: formatChannelLabel('C12345678', 'channel', 'general'),
    expected: '#general (C12345678, channel)',
  })
})

test('formatChannelLabel: dm with name', () => {
  assert({
    given: 'a DM with a resolved name',
    should: 'show name without # prefix',
    actual: formatChannelLabel('D055G78M5T3', 'dm', 'DM with Jane Smith'),
    expected: 'DM with Jane Smith (D055G78M5T3, dm)',
  })
})

test('formatChannelLabel: no name shows only type label', () => {
  assert({
    given: 'a channel with no resolved name',
    should: 'show only the type label',
    actual: formatChannelLabel('D055G78M5T3', 'dm'),
    expected: '(D055G78M5T3, dm)',
  })
})
