import { assert, test } from '#test'
import _dmPartnerAuthored from './fixtures/export-result-dm-partner-authored.json' with { type: 'json' }
import resolveRecipient from './resolveRecipient.ts'
import type { ConversationType } from './types.ts'

const dmPartnerAuthored = {
  ..._dmPartnerAuthored,
  conversationType: _dmPartnerAuthored.conversationType as ConversationType,
}

// ---------------------------------------------------------------------------
// Tests using the full export result fixture (DM where partner authored)
// ---------------------------------------------------------------------------

test('resolveRecipient: DM fixture — partner authored, resolves current user from thread', () => {
  const from = dmPartnerAuthored.message.userName // "Sarah Chen" (she sent the message)
  assert({
    given: 'a DM where the partner authored and thread has replies from the current user',
    should: 'return the current user name from thread replies',
    actual: resolveRecipient(dmPartnerAuthored, from),
    expected: 'Jane Smith',
  })
})

test('resolveRecipient: DM fixture — you replied, to is the partner', () => {
  const from = dmPartnerAuthored.thread.replies[0].userName // "Jane Smith" (you replied)
  assert({
    given: 'a full export result where you replied in the DM',
    should: 'return the DM partner',
    actual: resolveRecipient(dmPartnerAuthored, from),
    expected: 'Sarah Chen',
  })
})

test('resolveRecipient: unanswered DM uses selfName from the export', () => {
  assert({
    given: 'a DM the partner authored with no replies and a resolved selfName',
    should: 'return the current user',
    actual: resolveRecipient(
      {
        channelId: 'D0123DMABC',
        channelName: 'DM with Sarah Chen',
        channelMembers: ['Sarah Chen'],
        conversationType: 'dm',
        selfName: 'Jane Smith',
      },
      'Sarah Chen',
    ),
    expected: 'Jane Smith',
  })
})

test('resolveRecipient: unanswered DM without selfName falls back to partner', () => {
  assert({
    given: 'legacy export data with no selfName',
    should: 'keep the old partner fallback',
    actual: resolveRecipient(
      {
        channelId: 'D0123DMABC',
        channelMembers: ['Sarah Chen'],
        conversationType: 'dm',
      },
      'Sarah Chen',
    ),
    expected: 'Sarah Chen',
  })
})

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

test('resolveRecipient: channel returns #name', () => {
  assert({
    given: 'a channel conversation',
    should: 'return #channel-name',
    actual: resolveRecipient({
      channelId: 'C0789CHANEF',
      channelName: 'engineering',
      conversationType: 'channel',
    }),
    expected: '#engineering',
  })
})

test('resolveRecipient: channel with no name falls back to ID', () => {
  assert({
    given: 'a channel with no resolved name',
    should: 'return #channelId',
    actual: resolveRecipient({
      channelId: 'C0789CHANEF',
      conversationType: 'channel',
    }),
    expected: '#C0789CHANEF',
  })
})

// ---------------------------------------------------------------------------
// DM (inline fixtures)
// ---------------------------------------------------------------------------

test('resolveRecipient: DM partner sent, no thread — falls back to partner', () => {
  assert({
    given: 'a DM where the partner sent the message and there is no thread',
    should: 'fall back to partner name',
    actual: resolveRecipient(
      {
        channelId: 'D012ABC3DEF',
        channelName: 'DM with Mike Wilson',
        channelMembers: ['Mike Wilson'],
        conversationType: 'dm',
      },
      'Mike Wilson',
    ),
    expected: 'Mike Wilson',
  })
})

test('resolveRecipient: DM partner sent, thread has your reply', () => {
  assert({
    given: 'a DM where partner sent and thread has a reply from you',
    should: 'return your name from the thread',
    actual: resolveRecipient(
      {
        channelId: 'D012ABC3DEF',
        channelMembers: ['Mike Wilson'],
        conversationType: 'dm',
        thread: { replies: [{ userName: 'Jane Smith' }] },
      },
      'Mike Wilson',
    ),
    expected: 'Jane Smith',
  })
})

test('resolveRecipient: DM you sent the message', () => {
  assert({
    given: 'a DM where you sent the message',
    should: 'return the DM partner',
    actual: resolveRecipient(
      {
        channelId: 'D0ABC123GH',
        channelName: 'DM with Mike Wilson',
        channelMembers: ['Mike Wilson'],
        conversationType: 'dm',
      },
      'Jane Smith',
    ),
    expected: 'Mike Wilson',
  })
})

test('resolveRecipient: DM with no members falls back to channel name', () => {
  assert({
    given: 'a DM with no resolved members',
    should: 'return channel name',
    actual: resolveRecipient({
      channelId: 'D0ABC123GH',
      channelName: 'DM with Mike Wilson',
      conversationType: 'dm',
    }),
    expected: 'DM with Mike Wilson',
  })
})

// ---------------------------------------------------------------------------
// Group DM
// ---------------------------------------------------------------------------

test('resolveRecipient: group DM filters out message author', () => {
  assert({
    given: 'a group DM where Jane sent the message',
    should: 'return the other members',
    actual: resolveRecipient(
      {
        channelId: 'G01234ABCDE',
        channelMembers: ['Jane Smith', 'Mike Wilson', 'Alice Chen'],
        conversationType: 'group',
      },
      'Jane Smith',
    ),
    expected: 'Mike Wilson, Alice Chen',
  })
})

test('resolveRecipient: group DM with no from returns all members', () => {
  assert({
    given: 'a group DM with no from specified',
    should: 'return all members',
    actual: resolveRecipient({
      channelId: 'G01234ABCDE',
      channelMembers: ['Jane Smith', 'Mike Wilson'],
      conversationType: 'group',
    }),
    expected: 'Jane Smith, Mike Wilson',
  })
})
