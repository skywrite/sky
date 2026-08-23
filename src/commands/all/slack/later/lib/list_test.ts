import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { assert, test } from '#test'
import {
  backfillMissingMessages,
  laterChannelLabel,
  laterConversationKind,
  laterIsThreadReply,
  laterItemLink,
  renderLaterRow,
  resolveRowMemberNames,
  resolveRowMentions,
  resolveStaleChannels,
} from './list.ts'

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
    given: 'a group DM slug with resolved live members',
    should: 'show the member names instead of the slug handles',
    actual: laterChannelLabel(item({ channel_name: 'mpdm-alice--bob.smith--carol-1' }), [
      'Alice Doe',
      'Dana Roe',
      'Bob Smith',
    ]),
    expected: 'Alice Doe, Dana Roe, Bob Smith',
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

test('laterConversationKind classifies the conversation', () => {
  assert({
    given: 'a named channel',
    should: 'be a channel',
    actual: laterConversationKind(item({ channel_name: 'general' })),
    expected: 'channel',
  })
  assert({
    given: 'a DM (D-prefixed id)',
    should: 'be a dm',
    actual: laterConversationKind(item({ channel_id: 'D0123ABCDEF', channel_name: 'jane.doe' })),
    expected: 'dm',
  })
  assert({
    given: 'a group DM slug',
    should: 'be a group',
    actual: laterConversationKind(item({ channel_name: 'mpdm-alice--bob.smith--carol-1' })),
    expected: 'group',
  })
  assert({
    given: 'no channel name',
    should: 'be unknown',
    actual: laterConversationKind(item({})),
    expected: 'unknown',
  })
})

/** Colors depend on TTY detection, so assertions compare the uncolored text. */
const stripAnsi = (lines: string[]): string[] => lines.map((line) => line.replaceAll(/\u001B\[\d+m/g, ''))

test('renderLaterRow lays out head, snippet, and link lines', () => {
  const row = {
    item: item({ channel_name: 'general', message: { content: 'hello  world\nsecond line' } }),
    timeLabel: '2026-01-05 09:30',
    link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  }
  assert({
    given: 'a channel item with message content',
    should: 'render three aligned lines with a collapsed snippet',
    actual: stripAnsi(renderLaterRow(row, 0, { hyperlinks: false })),
    expected: [
      '   1. 2026-01-05 09:30  #general',
      '      hello world second line',
      '      https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
    ],
  })

  const linked = stripAnsi(renderLaterRow(row, 0, { hyperlinks: true }))
  assert({
    given: 'the same row with hyperlinks on',
    should: 'wrap the time in an OSC-8 link and drop the url line',
    expected: '2 lines, head linked: true',
    actual: `${linked.length} lines, head linked: ${linked[0].includes(
      ']8;;https://atlas.slack.com/archives/C0123ABCDEF/p17500000000001002026-01-05 09:30]8;;',
    )}`,
  })
})

test('renderLaterRow labels missing bodies and unresolved channels', () => {
  const link = 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100'
  assert({
    given: 'an item the export returned without a message',
    should: 'show a no-preview placeholder',
    actual: stripAnsi(
      renderLaterRow({ item: item({ channel_name: 'general' }), timeLabel: '09:30', link }, 1, { hyperlinks: false }),
    )[1],
    expected: '      (no preview — message not fetched)',
  })
  assert({
    given: 'a message with empty content',
    should: 'show a no-text placeholder',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_name: 'general', message: { content: '' } }), timeLabel: '09:30', link },
        1,
        { hyperlinks: false },
      ),
    )[1],
    expected: '      (no text)',
  })
  assert({
    given: 'an item whose channel no longer resolves',
    should: 'mark the conversation unavailable instead of printing a bare id',
    actual: stripAnsi(renderLaterRow({ item: item({}), timeLabel: '09:30', link }, 9, { hyperlinks: false }))[0],
    expected: '  10. 09:30  ⚠ unavailable channel C0123ABCDEF',
  })
})

test('resolveStaleChannels names dead ids from timestamp twins', () => {
  const stale = resolveStaleChannels([
    item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }),
    item({ channel_id: 'C0LIVE00001', channel_name: 'atlas-updates', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD99999', ts: '1750000003.000100' }),
  ])
  assert({
    given: 'a dead id with a same-ts item under a live channel',
    should: 'take the twin channel name',
    actual: stale.get('C0DEAD00001')?.name,
    expected: 'atlas-updates',
  })
  assert({
    given: 'the twinned ts',
    should: 'be marked a duplicate save',
    actual: stale.get('C0DEAD00001')?.duplicateTs.has('1750000001.000100'),
    expected: true,
  })
  assert({
    given: 'a sibling ts with no twin',
    should: 'not be marked a duplicate',
    actual: stale.get('C0DEAD00001')?.duplicateTs.has('1750000002.000100'),
    expected: false,
  })
  assert({
    given: 'a dead id with no twins at all',
    should: 'stay unnamed',
    actual: stale.get('C0DEAD99999')?.name,
    expected: undefined,
  })
})

test('renderLaterRow labels stale rows with the twin-inferred channel', () => {
  const link = 'https://atlas.slack.com/archives/C0DEAD00001/p1750000001000100'
  const stale = resolveStaleChannels([
    item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }),
    item({ channel_id: 'C0LIVE00001', channel_name: 'atlas-updates', ts: '1750000001.000100' }),
  ])
  assert({
    given: 'a duplicate save under a dead id',
    should: 'name the channel and mark the duplicate',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }), timeLabel: '09:30', link },
        0,
        { stale, hyperlinks: false },
      ),
    ).slice(0, 2),
    expected: [
      '   1. 09:30  #atlas-updates (duplicate save — stale channel id)',
      '      (same message as its live twin in this queue)',
    ],
  })
  assert({
    given: 'a stale-id save with no twin',
    should: 'name the channel and keep the no-preview placeholder',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }), timeLabel: '09:30', link },
        1,
        { stale, hyperlinks: false },
      ),
    ).slice(0, 2),
    expected: ['   2. 09:30  #atlas-updates (stale channel id)', '      (no preview — message not fetched)'],
  })
})

test('renderLaterRow shows a reply badge for threads', () => {
  const row = {
    item: item({ channel_name: 'general', message: { content: 'kickoff', reply_count: 3 } }),
    timeLabel: '09:30',
    link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  }
  assert({
    given: 'a message with replies',
    should: 'append a dim reply count to the head line',
    actual: stripAnsi(renderLaterRow(row, 0, { hyperlinks: false }))[0],
    expected: '   1. 09:30  #general  ↩ 3',
  })
})

test('backfillMissingMessages hydrates only bodyless rows on live channels', async () => {
  const reply = item({ channel_name: 'general', ts: '1750000010.000100' })
  const hasBody = item({ channel_name: 'general', ts: '1750000020.000100', message: { content: 'kept' } })
  const deadId = item({ ts: '1750000030.000100' })
  const wrongTs = item({ channel_name: 'general', ts: '1750000040.000100' })
  const gone = item({ channel_name: 'general', ts: '1750000050.000100' })

  const fetched: string[] = []
  await backfillMissingMessages(
    [
      { item: reply, link: 'link-reply' },
      { item: hasBody, link: 'link-body' },
      { item: deadId, link: 'link-dead' },
      { item: wrongTs, link: 'link-wrong-ts' },
      { item: gone, link: 'link-gone' },
    ],
    async (link) => {
      fetched.push(link)
      if (link === 'link-reply') {
        return {
          channel_id: 'C0123ABCDEF',
          ts: '1750000010.000100',
          content: 'threaded answer',
          thread_ts: '1749999999.000100',
        }
      }
      if (link === 'link-wrong-ts') {
        return { channel_id: 'C0123ABCDEF', ts: '1750000099.000100', content: 'someone else' }
      }
      return undefined
    },
  )

  assert({
    given: 'a mix of hydrated, bodyless, and dead-id rows',
    should: 'fetch only the bodyless rows on live channels',
    actual: fetched.sort(),
    expected: ['link-gone', 'link-reply', 'link-wrong-ts'],
  })
  assert({
    given: 'a backfilled thread reply',
    should: 'carry its content and read as a thread reply',
    actual: `${reply.message?.content} / ${laterIsThreadReply(reply)}`,
    expected: 'threaded answer / true',
  })
  assert({
    given: 'a row that already had a body',
    should: 'stay untouched',
    actual: hasBody.message?.content,
    expected: 'kept',
  })
  assert({
    given: 'a fetch that returned a different ts',
    should: 'be discarded',
    actual: wrongTs.message,
    expected: undefined,
  })
  assert({
    given: 'a fetch that found nothing',
    should: 'keep the row bodyless',
    actual: gone.message,
    expected: undefined,
  })
})

test('resolveRowMentions substitutes names into row bodies in place', async () => {
  const mentioned = item({
    channel_name: 'general',
    message: { content: 'thanks @U0123ABCDEF — see <#C0456ATLASX> and <!subteam^S0789TEAMAB>' },
  })
  const unknown = item({ channel_name: 'general', ts: '1750000001.000100', message: { content: 'ping @U0999MISSING' } })
  const bodyless = item({ channel_name: 'general', ts: '1750000002.000100' })

  const asked: Record<string, string[]> = {}
  await resolveRowMentions([{ item: mentioned }, { item: unknown }, { item: bodyless }], 'https://atlas.slack.com', {
    users: async (ids) => {
      asked.users = ids.sort()
      return new Map([['U0123ABCDEF', 'Jane Smith']])
    },
    channels: async (ids) => {
      asked.channels = ids
      return new Map([['C0456ATLASX', 'atlas-updates']])
    },
    usergroups: async (ids) => {
      asked.usergroups = ids
      return new Map([['S0789TEAMAB', 'atlas-core']])
    },
  })

  assert({
    given: 'rows with user, channel, and usergroup mentions',
    should: 'pass each collected id family to its resolver',
    actual: asked,
    expected: {
      users: ['U0123ABCDEF', 'U0999MISSING'],
      channels: ['C0456ATLASX'],
      usergroups: ['S0789TEAMAB'],
    },
  })
  assert({
    given: 'a body whose mentions all resolve',
    should: 'carry names instead of ids',
    actual: mentioned.message?.content,
    expected: 'thanks @Jane Smith — see #atlas-updates and @atlas-core',
  })
  assert({
    given: 'a mention that resolves nowhere',
    should: 'stay a readable raw id',
    actual: unknown.message?.content,
    expected: 'ping @U0999MISSING',
  })
  assert({
    given: 'a bodyless row',
    should: 'stay bodyless',
    actual: bodyless.message,
    expected: undefined,
  })
})

test('resolveRowMemberNames prefers live membership and excludes self', async () => {
  const inBoot = item({ channel_id: 'C0GROUPLIVE', channel_name: 'mpdm-alice--bob.smith--carol-1' })
  const notInBoot = item({
    channel_id: 'C0GROUPCOLD',
    channel_name: 'mpdm-alice--dana-1',
    ts: '1750000001.000100',
  })
  const askedUsers: string[][] = []
  const askedHandles: string[][] = []
  const members = await resolveRowMemberNames(
    [
      { item: inBoot },
      { item: notInBoot },
      { item: item({ channel_name: 'general', ts: '1750000002.000100' }) },
      { item: item({ channel_id: 'D0123ABCDEF', channel_name: 'jane.doe', ts: '1750000003.000100' }) },
    ],
    'https://atlas.slack.com',
    {
      // live membership covers the first group and carries the session user;
      // the second group predates the boot payload's window
      membership: async () => ({
        selfId: 'U0SELF00001',
        membersByChannel: new Map([['C0GROUPLIVE', ['U0SELF00001', 'U0ALICE0001', 'U0DANA00001']]]),
      }),
      users: async (ids) => {
        askedUsers.push(ids.sort())
        return new Map([
          ['U0ALICE0001', 'Alice Doe'],
          ['U0DANA00001', 'Dana Roe'],
        ])
      },
      handles: async (handles) => {
        askedHandles.push(handles.sort())
        return new Map([['alice', 'Alice Doe']])
      },
    },
  )
  assert({
    given: 'one boot-covered group and one older group among other rows',
    should: 'resolve member ids minus self, and slug handles only for the uncovered group',
    actual: { askedUsers, askedHandles },
    expected: { askedUsers: [['U0ALICE0001', 'U0DANA00001']], askedHandles: [['alice', 'dana']] },
  })
  assert({
    given: 'the resolved map',
    should: 'key member names by conversation id, slug fallback keeping raw handles for misses',
    actual: { live: members.get('C0GROUPLIVE'), cold: members.get('C0GROUPCOLD') },
    expected: { live: ['Alice Doe', 'Dana Roe'], cold: ['Alice Doe', 'dana'] },
  })

  let membershipCalls = 0
  await resolveRowMemberNames([{ item: item({ channel_name: 'general' }) }], 'https://atlas.slack.com', {
    membership: async () => {
      membershipCalls++
      return { membersByChannel: new Map() }
    },
    users: async () => new Map(),
    handles: async () => new Map(),
  })
  assert({
    given: 'no group rows at all',
    should: 'skip the membership fetch entirely',
    actual: membershipCalls,
    expected: 0,
  })
})

test('renderLaterRow shows member display names in group head lines', () => {
  const row = {
    item: item({ channel_name: 'mpdm-alice--bob.smith--carol-1', message: { content: 'sync?' } }),
    timeLabel: '09:30',
    link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  }
  assert({
    given: 'a group row with member names in context',
    should: 'label with the resolved names',
    actual: stripAnsi(
      renderLaterRow(row, 0, {
        hyperlinks: false,
        groupMembers: new Map([['C0123ABCDEF', ['Alice Doe', 'Bob Smith', 'Carol Roe']]]),
      }),
    )[0],
    expected: '   1. 09:30  Alice Doe, Bob Smith, Carol Roe',
  })
})

test('renderLaterRow marks saved thread replies, not thread parents', () => {
  const link = 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100'
  assert({
    given: 'a message whose thread_ts differs from its own ts',
    should: 'flag it as a thread reply',
    actual: stripAnsi(
      renderLaterRow(
        {
          item: item({ channel_name: 'general', message: { content: 'agreed', thread_ts: '1749990000.000100' } }),
          timeLabel: '09:30',
          link,
        },
        0,
        { hyperlinks: false },
      ),
    )[0],
    expected: '   1. 09:30  #general  ↳ thread reply',
  })
  assert({
    given: 'a thread parent (thread_ts equal to its own ts)',
    should: 'show the reply count and no thread-reply marker',
    actual: stripAnsi(
      renderLaterRow(
        {
          item: item({
            channel_name: 'general',
            message: { content: 'kickoff', thread_ts: '1750000000.000100', reply_count: 3 },
          }),
          timeLabel: '09:30',
          link,
        },
        0,
        { hyperlinks: false },
      ),
    )[0],
    expected: '   1. 09:30  #general  ↩ 3',
  })
})
