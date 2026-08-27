import { assert, test } from '#test'
import parseChannelTarget from './parseChannelTarget.ts'

test('parseChannelTarget() reads channel URLs, names, and ids', () => {
  assert({
    given: 'a channel URL',
    should: 'yield the id and workspace',
    expected: { channelId: 'C0ATLAS0001', workspaceUrl: 'https://atlas.slack.com' },
    actual: parseChannelTarget('https://atlas.slack.com/archives/C0ATLAS0001'),
  })
  assert({
    given: 'a message URL',
    should: 'still yield the channel',
    expected: 'C0ATLAS0001',
    actual: parseChannelTarget('https://atlas.enterprise.slack.com/archives/C0ATLAS0001/p1750000000000100')?.channelId,
  })
  assert({
    given: 'a #name',
    should: 'yield the bare name',
    expected: { channelName: 'releases' },
    actual: parseChannelTarget('#releases'),
  })
  assert({
    given: 'a bare channel id',
    should: 'yield it',
    expected: { channelId: 'C0ATLAS0001' },
    actual: parseChannelTarget('C0ATLAS0001'),
  })
  assert({
    given: 'a group DM id',
    should: 'yield it',
    expected: { channelId: 'G0ATLAS0001' },
    actual: parseChannelTarget('G0ATLAS0001'),
  })
  assert({
    given: 'text that names no channel',
    should: 'return undefined',
    expected: undefined,
    actual: parseChannelTarget('releases please'),
  })
  assert({
    given: 'a non-archive slack URL',
    should: 'return undefined',
    expected: undefined,
    actual: parseChannelTarget('https://atlas.slack.com/client/T0ATLAS/C0ATLAS0001'),
  })
})
