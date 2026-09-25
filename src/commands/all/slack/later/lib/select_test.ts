import { assert, test } from '#test'
import type { LaterConversation } from './conversations.ts'
import { conversationMatches, parseConversationQuery, selectConversations } from './select.ts'

const conversation = (
  id: string,
  kind: LaterConversation['kind'],
  name: string,
  people: string[][] = [],
): LaterConversation => ({
  id,
  kind,
  label: kind === 'channel' ? `#${name}` : name,
  rawName: kind === 'group' ? 'mpdm-old--handles-1' : name,
  aliases: [name],
  members: people.map((aliases, index) => ({ id: `U${index}`, name: aliases[0], aliases })),
  membersComplete: true,
  count: 2,
})
const jane = ['Jane Doe', 'Jane', 'jane.doe']
const john = ['John Roe', 'John', 'john.roe']
const group = conversation('C0GROUP', 'group', 'Jane Doe, John Roe', [jane, john])
const match = (value: LaterConversation, query: string): boolean =>
  conversationMatches(value, parseConversationQuery(query)!)

test('conversation selectors preserve type prefixes even with wildcards', () => {
  const values = [
    conversation('C0CHANNEL', 'channel', 'Jane-news'),
    conversation('D0JANE', 'dm', 'Jane Doe'),
    conversation('C0CONNECT', 'dm', 'Jane Smith'),
    group,
  ]
  for (const [query, expected] of [
    [' #J* ', ['C0CHANNEL']],
    ['@Jane*', ['D0JANE', 'C0CONNECT']],
    ['J*', ['C0CHANNEL', 'D0JANE', 'C0CONNECT', 'C0GROUP']],
    ['#mpdm-*', []],
  ] as Array<[string, string[]]>) {
    assert({
      given: query,
      should: 'apply the type restriction before matching names',
      actual: values.filter((value) => match(value, query)).map((value) => value.id),
      expected,
    })
  }
})

test('group selectors compare the complete set of distinct participants using all aliases', () => {
  for (const [query, expected] of [
    ['Jane Doe, John Roe', true],
    [' john.roe , JANE ', true],
    ['@John, @Jane Doe', false],
    ['J*, Jane Doe', true],
    ['Jane*, Jane*', false],
    ['Jane Doe, jane.doe', false],
    ['Jane Doe', false],
    ['Jane Doe, John Roe, Alex Doe', false],
    ['Jan, John Roe', false],
  ] as Array<[string, boolean]>) {
    assert({
      given: query,
      should: 'match exactly one distinct member per name, in any order',
      actual: match(group, query),
      expected,
    })
  }
  const larger = { ...group, members: [...group.members, { id: 'U2', name: 'Alex Doe', aliases: ['Alex Doe'] }] }
  assert({
    given: 'a larger group containing the requested pair',
    should: 'not match the subset',
    actual: match(larger, 'Jane Doe, John Roe'),
    expected: false,
  })
  assert({
    given: 'unverified group membership',
    should: 'require a precise ID or raw slug',
    actual: ['Jane Doe, John Roe', 'C0GROUP', 'mpdm-old--handles-1'].map((query) =>
      match({ ...group, membersComplete: false }, query),
    ),
    expected: [false, true, true],
  })
})

test('only star is a wildcard and names are otherwise exact', () => {
  const cases: Array<[string, string, boolean]> = [
    ['general', 'general', true],
    [' #General ', 'general', true],
    ['gen', 'general', false],
    ['#atlas-*', 'atlas-api', true],
    ['atlas-*', 'old-atlas-api', false],
    ['atlas-*', 'atlas', false],
    ['atlas-*', 'atlas-', true],
    ['*-updates', 'atlas-updates-old', false],
    ['atlas-**-updates', 'atlas-api-updates', true],
    ['*atlas*updates*', 'updates-atlas', false],
    ['jane.doe*', 'jane.doe (guest)', true],
    ['jane.doe*', 'janeXdoe', false],
    ['jane[team]*', 'jane[team] smith', true],
    ['jane[team]*', 'janet smith', false],
    ['jane?*', 'jane doe', false],
    ['jane+*', 'jane+doe', true],
    ['(jane|john)*', 'john', false],
    ['jane\\doe*', 'jane\\doe (guest)', true],
  ]
  for (const [query, name, expected] of cases) {
    assert({
      given: `${query} against ${name}`,
      should: 'interpret only star as a wildcard',
      actual: match(conversation('C0TEST', 'channel', name), query),
      expected,
    })
  }
})

test('exact ambiguous names fail with actionable choices; wildcards deliberately select several', () => {
  const values = [
    conversation('C0JANE', 'channel', 'Jane Doe'),
    conversation('D0JANE', 'dm', 'Jane Doe'),
    conversation('D0OTHER', 'dm', 'Jane Doe'),
  ]
  const map = new Map(values.map((value) => [value.id, value]))
  for (const query of ['Jane Doe', '@Jane Doe']) {
    const result = selectConversations(map, parseConversationQuery(query))
    assert({
      given: query,
      should: 'stop before selecting any IDs and print explicit disambiguation',
      actual: [
        result.ids.size,
        result.error?.includes('Ambiguous --channel'),
        result.error?.includes("--channel 'D0JANE'"),
      ],
      expected: [0, true, true],
    })
  }
  for (const [query, expected] of [
    ['#Jane Doe', ['C0JANE']],
    ['D0JANE', ['D0JANE']],
    ['@Jane*', ['D0JANE', 'D0OTHER']],
  ] as Array<[string, string[]]>) {
    assert({
      given: query,
      should: 'select the explicit scope',
      actual: [...selectConversations(map, parseConversationQuery(query)).ids],
      expected,
    })
  }
})

test('invalid selectors and unresolved conversation types cannot broaden selection', () => {
  for (const query of ['', '  ', '#', '@', 'Jane, ', ', John', '#Jane, John', '##general', '@@Jane']) {
    assert({
      given: query,
      should: 'reject an empty or malformed selector',
      actual: parseConversationQuery(query),
      expected: undefined,
    })
  }
  const unknown = conversation('C0UNKNOWN', 'unknown', 'Jane Doe')
  assert({
    given: 'a name without verified conversation type',
    should: 'allow only the explicit ID',
    actual: ['#Jane*', '@Jane*', 'Jane*', 'C0UNKNOWN'].map((query) => match(unknown, query)),
    expected: [false, false, false, true],
  })
})

test('empty matches suggest readable scoped names with types and item counts', () => {
  const dm = conversation('D0JANE', 'dm', 'Jane Doe')
  const values = new Map([group, dm].map((value) => [value.id, value]))
  const result = selectConversations(values, parseConversationQuery('Nobody, Else'))
  assert({
    given: 'no matching group',
    should: 'show usable group names without internal slugs or unrelated DM choices',
    actual: [
      result.ids.size,
      result.lines.join('\n').includes('Jane Doe, John Roe — group DM, 2 items'),
      result.lines.join('\n').includes('mpdm-'),
      result.lines.join('\n').includes('D0JANE'),
    ],
    expected: [0, true, false, false],
  })
})

test('an explicit DM prefix keeps commas literal and an explicit ID wins over names', () => {
  const dm = conversation('D0JANE', 'dm', 'Doe, Jane')
  const channel = conversation('C0CHANNEL', 'channel', 'D0JANE')
  const values = new Map([dm, channel].map((value) => [value.id, value]))
  for (const query of ['@Doe, Jane', 'D0JANE']) {
    assert({
      given: query,
      should: 'select only the explicitly targeted DM',
      actual: [...selectConversations(values, parseConversationQuery(query)).ids],
      expected: ['D0JANE'],
    })
  }
})
