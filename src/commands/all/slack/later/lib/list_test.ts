import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { assert, test } from '#test'
import { laterChannelLabel, laterItemLink } from './list.ts'

const item = (over: Partial<AgentSlackLaterItem>): AgentSlackLaterItem => ({
  channel_id: 'C0123ABCDEF',
  ts: '1750000000.000100',
  ...over,
})

test('laterChannelLabel picks the right conversation label', () => {
  assert({
    given: 'a named channel',
    should: 'prefix #',
    actual: laterChannelLabel(item({ channel_name: 'general' })),
    expected: '#general',
  })
  assert({
    given: 'a DM (D-prefixed id)',
    should: 'use the bare person name',
    actual: laterChannelLabel(item({ channel_id: 'D0123ABCDEF', channel_name: 'jane.doe' })),
    expected: 'jane.doe',
  })
  assert({
    given: 'a group DM slug',
    should: 'list the member handles',
    actual: laterChannelLabel(item({ channel_name: 'mpdm-alice--bob.smith--carol-1' })),
    expected: 'alice, bob.smith, carol',
  })
  assert({
    given: 'no channel name',
    should: 'fall back to the id',
    actual: laterChannelLabel(item({})),
    expected: 'C0123ABCDEF',
  })
})

test('laterItemLink builds the archives permalink', () => {
  assert({
    given: 'a workspace and an item',
    should: 'join with a p-prefixed dotless ts',
    actual: laterItemLink('https://atlas.slack.com', item({})),
    expected: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  })
})
