import { assert, test } from '#test'
import { historyRowLink } from './checkChannelWatches.ts'

test('historyRowLink() builds the archive URL slack:follow:message accepts', () => {
  assert({
    given: 'a history row ts and channel',
    should: 'build a p-link on the workspace host',
    expected: 'https://atlas.slack.com/archives/C0ATLAS0001/p1750000000000100',
    actual: historyRowLink('1750000000.000100', 'C0ATLAS0001', 'https://atlas.slack.com'),
  })
  assert({
    given: 'a workspace URL with a trailing slash',
    should: 'not double the slash',
    expected: 'https://atlas.slack.com/archives/C0ATLAS0001/p1750000000000100',
    actual: historyRowLink('1750000000.000100', 'C0ATLAS0001', 'https://atlas.slack.com/'),
  })
})
