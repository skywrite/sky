import { assert, test } from '#test'
import collectUserIds from './collectUserIds.ts'
import messageFixture from './fixtures/agent-slack-message-get-connect-dm.json' with { type: 'json' }

test('collectUserIds: extracts author from fixture message', () => {
  assert({
    given: 'the connect DM message fixture',
    should: 'return the author user_id',
    actual: collectUserIds([messageFixture.message]),
    expected: ['U0123LOCALX'],
  })
})

test('collectUserIds: extracts @mentions from content', () => {
  assert({
    given: 'a message mentioning two users',
    should: 'return both mentioned user IDs',
    actual: collectUserIds([
      { channel_id: 'C123', ts: '1.0', content: 'Hey @U0456CONNEX and @U0789BOTABC check this' },
    ]).sort(),
    expected: ['U0456CONNEX', 'U0789BOTABC'],
  })
})

test('collectUserIds: deduplicates across author and mentions', () => {
  assert({
    given: 'a message where the author also mentions themselves',
    should: 'return the user_id only once',
    actual: collectUserIds([
      { channel_id: 'C123', ts: '1.0', author: { user_id: 'U0123LOCALX' }, content: 'cc @U0123LOCALX' },
    ]),
    expected: ['U0123LOCALX'],
  })
})

test('collectUserIds: handles messages with no author or content', () => {
  assert({
    given: 'a message with no author and no content',
    should: 'return empty array',
    actual: collectUserIds([{ channel_id: 'C123', ts: '1.0' }]),
    expected: [],
  })
})

test('collectUserIds: collects across multiple messages', () => {
  assert({
    given: 'multiple messages with different authors',
    should: 'return all unique user IDs',
    actual: collectUserIds([
      { channel_id: 'C123', ts: '1.0', author: { user_id: 'U0123LOCALX' } },
      { channel_id: 'C123', ts: '2.0', author: { user_id: 'U0456CONNEX' } },
      { channel_id: 'C123', ts: '3.0', author: { user_id: 'U0123LOCALX' } },
    ]).sort(),
    expected: ['U0123LOCALX', 'U0456CONNEX'],
  })
})
