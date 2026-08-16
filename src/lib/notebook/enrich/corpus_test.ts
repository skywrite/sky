import { assert, test } from '#test'
import { buildTagMenu, corpusMediumOf, majorityTagsFor, recordsFromRows, sliceBefore, tagHistoryFor } from './corpus.ts'
import type { CorpusRows, MessageRecord } from './corpus.ts'

// ── recordsFromRows: GraphQL rows → corpus records ─────────────────────────

const ROWS: CorpusRows = {
  messages: [
    {
      medium: 'Slack',
      from: 'Jane Doe',
      to: '#atlas',
      date: '2026-01-05',
      summary: 'Rollout status',
      tags: ['Work/Eng'],
      rel: ['projects/Atlas-Rollout'],
      path: '/nb/time/2026/01/05/a.md',
    },
    {
      medium: 'Email',
      from: 'Joe Smith',
      to: 'Jane Doe',
      date: '2026-01-06',
      tags: [],
      rel: [],
      path: '/nb/time/2026/01/06/b.md',
    },
    {
      medium: 'iMessage Audio',
      from: 'Jane Doe',
      date: '2026-01-04',
      tags: ['Family'],
      rel: [],
      path: '/nb/time/2026/01/04/c.md',
    },
  ],
  meetings: [
    {
      who: 'Jane Doe, Joe Smith',
      date: '2026-01-07',
      summary: 'Weekly sync',
      tags: ['Work/Eng'],
      rel: [],
      path: '/nb/time/2026/01/07/m.md',
      markdown: '# Weekly sync',
    },
  ],
  journals: [{ date: '2026-01-08', tags: ['Journal/Video'], rel: ['Jane Doe'], path: '/nb/time/2026/01/08/j.md' }],
  chats: [
    {
      date: '2026-01-09',
      summary: 'Atlas rollout brainstorm',
      tags: ['Work/Eng'],
      rel: ['projects/Atlas-Rollout'],
      path: '/nb/time/2026/01/09/actions/ai-chats/c.md',
    },
  ],
}

test('corpusMediumOf folds message platforms into slack, email, and message', () => {
  assert({ given: 'Slack', should: 'map to slack', actual: corpusMediumOf('Slack'), expected: 'slack' })
  assert({ given: 'Email', should: 'map to email', actual: corpusMediumOf('Email'), expected: 'email' })
  assert({
    given: 'any other platform',
    should: 'map to message',
    actual: corpusMediumOf('iMessage Audio'),
    expected: 'message',
  })
})

test('recordsFromRows keeps only requested mediums', () => {
  const records = recordsFromRows(ROWS, ['slack'])
  assert({
    given: 'slack requested from mixed rows',
    should: 'keep only the slack record',
    actual: records.map((r) => r.medium),
    expected: ['slack'],
  })
})

test('recordsFromRows maps meetings and journals', () => {
  const records = recordsFromRows(ROWS, ['meeting', 'journal'])
  const meeting = records.find((r) => r.medium === 'meeting')
  const journal = records.find((r) => r.medium === 'journal')
  assert({
    given: 'a meeting row',
    should: 'use who as the conversation identity',
    actual: meeting?.to,
    expected: 'Jane Doe, Joe Smith',
  })
  assert({
    given: 'a meeting row with markdown',
    should: 'carry the body',
    actual: meeting?.body,
    expected: '# Weekly sync',
  })
  assert({ given: 'a journal row', should: 'have no conversation identity', actual: journal?.to, expected: undefined })
  assert({ given: 'a journal row', should: 'keep tags', actual: journal?.tags, expected: ['Journal/Video'] })
})

test('recordsFromRows maps chats without a conversation identity', () => {
  const records = recordsFromRows(ROWS, ['chat'])
  assert({
    given: 'chat requested from mixed rows',
    should: 'keep only the chat record',
    actual: records.map((r) => r.medium),
    expected: ['chat'],
  })
  assert({ given: 'a chat row', should: 'have no conversation identity', actual: records[0]?.to, expected: undefined })
  assert({
    given: 'a chat row',
    should: 'keep its summary',
    actual: records[0]?.summary,
    expected: 'Atlas rollout brainstorm',
  })
  assert({ given: 'a chat row', should: 'keep tags', actual: records[0]?.tags, expected: ['Work/Eng'] })
})

test('recordsFromRows falls back to from when to is absent', () => {
  const records = recordsFromRows(ROWS, ['message'])
  assert({
    given: 'a from-only DM row',
    should: 'use from as the conversation identity',
    actual: records[0]?.to,
    expected: 'Jane Doe',
  })
})

test('recordsFromRows sorts by day then path and defaults body empty', () => {
  const records = recordsFromRows(ROWS, ['slack', 'email', 'message', 'meeting', 'journal'])
  assert({
    given: 'mixed-medium rows',
    should: 'sort by date',
    actual: records.map((r) => r.date),
    expected: ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
  })
  assert({ given: 'no markdown requested', should: 'default body empty', actual: records[0]?.body, expected: '' })
})

// ── menus, history, and slicing over records ────────────────────────────────

function rec(date: string, to: string, tags: string[]): MessageRecord {
  return { path: `${date}/${to}`, date, medium: 'slack', to, tags, rel: [], body: '' }
}

const RECORDS: MessageRecord[] = [
  rec('2026-01-05', '#atlas', ['Work/Eng', 'Work/Incident']),
  rec('2026-01-06', '#atlas', ['Work/Eng']),
  rec('2026-01-07', '#music', ['Hobby/Music']),
  rec('2026-01-08', '#atlas', ['Work/Eng']),
]

test('buildTagMenu counts and orders tags', () => {
  const menu = buildTagMenu(RECORDS)
  assert({
    given: 'records with repeated tags',
    should: 'order by count',
    actual: menu[0],
    expected: { tag: 'Work/Eng', count: 3 },
  })
})

test('sliceBefore excludes the given day', () => {
  const slice = sliceBefore(RECORDS, '2026-01-07')
  assert({
    given: 'a slice boundary',
    should: 'keep strictly earlier records',
    actual: slice.map((r) => r.date),
    expected: ['2026-01-05', '2026-01-06'],
  })
})

test('tagHistoryFor only sees its conversation', () => {
  const history = tagHistoryFor(RECORDS, '#music')
  assert({
    given: 'a conversation filter',
    should: 'return that conversation tags',
    actual: history,
    expected: [{ tag: 'Hobby/Music', count: 1 }],
  })
  assert({ given: 'no conversation', should: 'return empty', actual: tagHistoryFor(RECORDS, undefined), expected: [] })
})

test('majorityTagsFor picks the most frequent exact set', () => {
  assert({
    given: 'a conversation with a repeated exact tag set',
    should: 'return it',
    actual: majorityTagsFor(RECORDS, '#atlas'),
    expected: ['Work/Eng'],
  })
  assert({
    given: 'a conversation with only untagged files',
    should: 'return empty',
    actual: majorityTagsFor([rec('2026-01-08', '#x', [])], '#x'),
    expected: [],
  })
})
