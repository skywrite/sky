import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { assert, test } from '#test'
import { type ConversationResolvers, fetchCompleteMembers, resolveLaterConversations } from './conversations.ts'
import { renderLaterRow } from './list.ts'
import { conversationMatches, parseConversationQuery } from './select.ts'

const item = (id: string, name?: string): AgentSlackLaterItem => ({
  channel_id: id,
  channel_name: name,
  ts: '1750000000.000100',
})
const profile = (id: string, name: string, handle: string) => ({
  id,
  name,
  aliases: [name, name.split(' ')[0], handle],
})
const resolvers = (overrides: Partial<ConversationResolvers> = {}): ConversationResolvers => ({
  membership: async () => ({ selfId: 'U0SELF', membersByChannel: new Map(), conversations: new Map() }),
  info: async () => undefined,
  members: async () => undefined,
  self: async () => undefined,
  users: async () => new Map(),
  handles: async () => new Map(),
  ...overrides,
})

test('conversation resolution uses live members, keeps aliases, excludes self, and shares labels with rendering', async () => {
  const row = item('C0GROUP', 'mpdm-old--handles-1')
  let infoCalls = 0
  let userCalls = 0
  const values = await resolveLaterConversations(
    [row, { ...row, ts: '1750000001.000100' }],
    'https://atlas.slack.com',
    resolvers({
      membership: async () => ({
        selfId: 'U0SELF',
        membersByChannel: new Map(),
        conversations: new Map([['C0GROUP', { kind: 'group', memberIds: ['U0SELF', 'U0JANE', 'U0JOHN'] }]]),
      }),
      info: async () => {
        infoCalls++
        return undefined
      },
      users: async () => {
        userCalls++
        return new Map([
          ['U0SELF', profile('U0SELF', 'Alex Doe', 'alex')],
          ['U0JANE', profile('U0JANE', 'Jane Doe', 'jane.doe')],
          ['U0JOHN', profile('U0JOHN', 'John Roe', 'john.roe')],
        ])
      },
    }),
  )
  const group = values.get('C0GROUP')!
  assert({
    given: 'two saved items in a renamed group',
    should: 'resolve once and count both, using the current other participants',
    actual: [group.label, group.count, infoCalls, userCalls, group.membersComplete],
    expected: ['Jane Doe, John Roe', 2, 0, 1, true],
  })
  assert({
    given: 'a handle and display-name query in reversed order',
    should: 'select the same readable conversation used by the row',
    actual: [
      conversationMatches(group, parseConversationQuery('john.roe, Jane')!),
      renderLaterRow({ item: row, timeLabel: '12:00', link: 'https://example.com/message' }, 0, {
        conversations: values,
      })
        .join('\n')
        .includes('Jane Doe, John Roe'),
    ],
    expected: [true, true],
  })
})

test('Slack Connect DMs with channel-like ids keep DM scope', async () => {
  const values = await resolveLaterConversations(
    [item('C0CONNECT', 'jane.doe'), item('C0CHANNEL', 'Jane-news')],
    'https://atlas.slack.com',
    resolvers({
      info: async (id) =>
        id === 'C0CONNECT' ? { kind: 'dm', memberIds: ['U0JANE'] } : { kind: 'channel', name: 'Jane-news' },
      users: async () => new Map([['U0JANE', profile('U0JANE', 'Jane Doe', 'jane.doe')]]),
    }),
  )
  assert({
    given: 'metadata identifies a C-prefixed conversation as a DM',
    should: 'exclude it from # while allowing person aliases',
    actual: ['#J*', '@Jane', '@jane.doe'].map((query) =>
      [...values.values()]
        .filter((value) => conversationMatches(value, parseConversationQuery(query)!))
        .map((value) => value.id),
    ),
    expected: [['C0CHANNEL'], ['C0CONNECT'], ['C0CONNECT']],
  })
})

test('unresolved participants and unknown self never shrink a group into a matching subset', async () => {
  for (const selfKnown of [true, false]) {
    const values = await resolveLaterConversations(
      [item('C0GROUP', 'mpdm-jane--john-1')],
      'https://atlas.slack.com',
      resolvers({
        membership: async () => ({
          selfId: selfKnown ? 'U0SELF' : undefined,
          membersByChannel: new Map(),
          conversations: new Map([
            ['C0GROUP', { kind: 'group', memberIds: ['U0SELF', 'U0JANE', 'U0JOHN', 'U0UNKNOWN'] }],
          ]),
        }),
        users: async () =>
          new Map([
            ['U0JANE', profile('U0JANE', 'Jane Doe', 'jane')],
            ['U0JOHN', profile('U0JOHN', 'John Roe', 'john')],
          ]),
      }),
    )
    assert({
      given: `an unresolved participant with self known: ${selfKnown}`,
      should: 'keep the full membership and reject the smaller group query',
      actual: [
        values.get('C0GROUP')!.members.length,
        conversationMatches(values.get('C0GROUP')!, parseConversationQuery('Jane Doe, John Roe')!),
      ],
      expected: [selfKnown ? 3 : 4, false],
    })
  }
})

test('slug fallback remains readable without pretending to prove current membership', async () => {
  const values = await resolveLaterConversations(
    [item('C0GROUP', 'mpdm-alex--jane--john-1')],
    'https://atlas.slack.com',
    resolvers({
      handles: async () =>
        new Map([
          ['alex', profile('U0SELF', 'Alex Doe', 'alex')],
          ['jane', profile('U0JANE', 'Jane Doe', 'jane')],
          ['john', profile('U0JOHN', 'John Roe', 'john')],
        ]),
    }),
  )
  const group = values.get('C0GROUP')!
  assert({
    given: 'unavailable live membership and resolved creation-time handles',
    should: 'exclude self for display but require an ID or slug for exact capture',
    actual: [
      group.label,
      group.membersComplete,
      conversationMatches(group, parseConversationQuery('Jane Doe, John Roe')!),
      conversationMatches(group, parseConversationQuery('C0GROUP')!),
    ],
    expected: ['Jane Doe, John Roe', false, false, true],
  })
})

test('complete member fetching requires every page', async () => {
  const calls: unknown[] = []
  const members = await fetchCompleteMembers('C0GROUP', 'https://atlas.slack.com', async (_url, _method, params) => {
    calls.push(params)
    return params.cursor
      ? { members: ['U0JOHN'] }
      : { members: ['U0SELF', 'U0JANE'], response_metadata: { next_cursor: 'page2' } }
  })
  assert({
    given: 'membership spanning two pages',
    should: 'collect all participants',
    actual: [members, calls.length],
    expected: [['U0SELF', 'U0JANE', 'U0JOHN'], 2],
  })
  const incomplete = await fetchCompleteMembers('C0GROUP', 'https://atlas.slack.com', async (_url, _method, params) =>
    params.cursor ? undefined : { members: ['U0SELF', 'U0JANE'], response_metadata: { next_cursor: 'page2' } },
  )
  assert({
    given: 'the second page fails',
    should: 'discard the incomplete membership',
    actual: incomplete,
    expected: undefined,
  })
})

test('unavailable type metadata never guesses that a named C conversation is a channel', async () => {
  const values = await resolveLaterConversations(
    [item('C0UNKNOWN', 'Jane Doe')],
    'https://atlas.slack.com',
    resolvers(),
  )
  const unknown = values.get('C0UNKNOWN')!
  assert({
    given: 'a readable name with no conversation metadata',
    should: 'require an explicit ID instead of matching a channel wildcard',
    actual: [
      unknown.kind,
      conversationMatches(unknown, parseConversationQuery('#J*')!),
      conversationMatches(unknown, parseConversationQuery('C0UNKNOWN')!),
    ],
    expected: ['unknown', false, true],
  })
})
