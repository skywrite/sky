import { assert, test } from '#test'
import type { SlackDraft } from './drafts.ts'
import { type DraftResolvers, type DraftRow, normalizeMentions, renderDraftRow, resolveDraftRows } from './rows.ts'

const WORKSPACE = 'https://atlas.enterprise.slack.com'
const ESC = String.fromCharCode(27)

const draft = (overrides: Partial<SlackDraft>): SlackDraft => ({
  id: 'Dr1',
  text: 'hello',
  last_updated_ts: '1700000000.000000',
  date_scheduled: 0,
  file_ids: [],
  destinations: [{ channel_id: 'C0ATLAS1', channel_name: 'atlas' }],
  ...overrides,
})

const resolvers = (calls: string[] = []): DraftResolvers => ({
  conversation: async (id) => {
    calls.push(`conversation:${id}`)
    return id === 'D0HIDDEN'
      ? { name: 'DM with Jane Doe', detectedType: 'dm' }
      : id === 'C0HIDDEN'
        ? { name: 'atlas-ops', detectedType: 'channel' }
        : {}
  },
  membership: async () => {
    calls.push('membership')
    return { selfId: 'U0SELF01', membersByChannel: new Map([['C0GROUP1', ['U0JANE01', 'U0BOB001', 'U0SELF01']]]) }
  },
  users: async (ids) => {
    calls.push(`users:${ids.join(',')}`)
    return new Map([
      ['U0JANE01', 'Jane Doe'],
      ['U0BOB001', 'Bob Roe'],
    ])
  },
  handles: async (handles) => {
    calls.push(`handles:${handles.join(',')}`)
    return new Map([
      ['jane', 'Jane Doe'],
      ['carol', 'Carol Poe'],
    ])
  },
  channels: async (ids) => {
    calls.push(`channels:${ids.join(',')}`)
    return new Map([['C0ATLAS1', 'atlas']])
  },
  usergroups: async (ids) => {
    calls.push(`usergroups:${ids.join(',')}`)
    return new Map([['S0ATLAS1', 'atlas-team']])
  },
})

test('resolveDraftRows: labels every destination kind and resolves mentions in bulk', async () => {
  const calls: string[] = []
  const rows = await resolveDraftRows(
    [
      draft({
        id: 'Dr1',
        destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100', channel_name: 'atlas' }],
      }),
      draft({ id: 'Dr2', destinations: [{ channel_id: 'D0JANE01', channel_name: 'jane' }] }),
      draft({ id: 'Dr3', destinations: [{ channel_id: 'C0GROUP1', channel_name: 'mpdm-jane--bob--self-1' }] }),
      draft({ id: 'Dr4', destinations: [{ channel_id: 'C0GROUP2', channel_name: 'mpdm-jane--carol-1' }] }),
      draft({ id: 'Dr5', destinations: [{ channel_id: 'D0HIDDEN' }] }),
      draft({ id: 'Dr6', destinations: [{ channel_id: 'C0HIDDEN' }] }),
      draft({ id: 'Dr7', destinations: [{ channel_id: 'C0GONE01' }] }),
      draft({ id: 'Dr8', destinations: [] }),
      draft({ id: 'Dr9', text: 'cc <@U0BOB001> in <#C0ATLAS1> <!subteam^S0ATLAS1> <!here>' }),
    ],
    WORKSPACE,
    'UTC',
    resolvers(calls),
  )
  assert({
    given:
      'drafts to a channel thread, a DM, two group DMs, two unnamed conversations Sky can name, one nobody can, and nowhere',
    should: 'label each by kind, and link threads and conversations',
    actual: rows.map((row) => [row.kind, row.label, row.link ?? null]),
    expected: [
      ['channel', '#atlas', `${WORKSPACE}/archives/C0ATLAS1/p1699999999000100`],
      ['dm', 'jane', `${WORKSPACE}/archives/D0JANE01`],
      ['group', 'Jane Doe and Bob Roe', `${WORKSPACE}/archives/C0GROUP1`],
      ['group', 'Jane Doe and Carol Poe', `${WORKSPACE}/archives/C0GROUP2`],
      ['dm', 'Jane Doe', `${WORKSPACE}/archives/D0HIDDEN`],
      ['channel', '#atlas-ops', `${WORKSPACE}/archives/C0HIDDEN`],
      ['unknown', 'C0GONE01', `${WORKSPACE}/archives/C0GONE01`],
      ['none', '(no destination)', null],
      ['channel', '#atlas', `${WORKSPACE}/archives/C0ATLAS1`],
    ],
  })
  assert({
    given: 'a body with user, channel, usergroup, and broadcast mentions in wire form',
    should: 'substitute resolved names',
    actual: rows[8].text,
    expected: 'cc @Bob Roe in #atlas @atlas-team @here',
  })
  assert({
    given: 'the time label',
    should: 'format the last edit in the given zone',
    actual: rows[0].timeLabel,
    expected: '2023-11-14 22:13',
  })
  assert({
    given: 'the lookups made',
    should: 'be one bulk call per source, the boot payload once, and one lookup per unnamed conversation',
    actual: calls,
    expected: [
      'membership',
      'users:U0BOB001,U0JANE01',
      'handles:jane,carol',
      'channels:C0ATLAS1',
      'usergroups:S0ATLAS1',
      'conversation:D0HIDDEN',
      'conversation:C0HIDDEN',
      'conversation:C0GONE01',
    ],
  })
})

test('resolveDraftRows: skips the boot payload when no draft targets a group', async () => {
  const calls: string[] = []
  await resolveDraftRows([draft({})], WORKSPACE, 'UTC', resolvers(calls))
  assert({
    given: 'a channel-only page',
    should: 'never fetch membership',
    actual: calls.includes('membership'),
    expected: false,
  })
})

test('normalizeMentions: wire forms to what resolveContent reads', () => {
  assert({
    given: 'user mentions with and without labels, and a broadcast',
    should: 'become bare @ids and @here',
    actual: normalizeMentions('<@U0JANE01> <@W0BOB001|bob> <!channel|@channel> <#C0ATLAS1|atlas>'),
    expected: '@U0JANE01 @W0BOB001 @channel <#C0ATLAS1|atlas>',
  })
})

const stripAnsi = (lines: string[]): string[] =>
  lines.map((line) => line.replaceAll(new RegExp(`${ESC}\\[\\d+m`, 'g'), ''))

const row = (overrides: Partial<DraftRow> = {}): DraftRow => ({
  draft: draft({}),
  timeLabel: '2023-11-14 22:13',
  link: `${WORKSPACE}/archives/C0ATLAS1`,
  kind: 'channel',
  label: '#atlas',
  text: 'hello',
  ...overrides,
})

test('renderDraftRow: head line, snippet, and url line without hyperlinks', () => {
  assert({
    given: 'a channel draft with hyperlinks off',
    should: 'print number, time, label, snippet, and the url as a third line',
    actual: stripAnsi(renderDraftRow(row(), 0, { hyperlinks: false })),
    expected: ['    1. 2023-11-14 22:13  #atlas', '       hello', `       ${WORKSPACE}/archives/C0ATLAS1`],
  })
  const linked = stripAnsi(renderDraftRow(row(), 0, { hyperlinks: true }))
  assert({
    given: 'the same row with hyperlinks on',
    should: 'wrap the time in an OSC-8 link and drop the url line',
    actual: [linked.length, linked[0].includes(`${ESC}]8;;${WORKSPACE}/archives/C0ATLAS1`)],
    expected: [2, true],
  })
})

test('renderDraftRow: badges and placeholders', () => {
  const scheduled = draft({
    destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100', channel_name: 'atlas' }],
    date_scheduled: 1700003600,
    file_ids: ['F1', 'F2'],
    text: '',
  })
  assert({
    given: 'a scheduled thread reply with files and no text, at index 41',
    should: 'show every badge and the no-text placeholder',
    actual: stripAnsi(renderDraftRow(row({ draft: scheduled, text: '', link: undefined }), 41, { hyperlinks: false })),
    expected: ['   42. 2023-11-14 22:13  #atlas  ↳ thread reply  scheduled send  2 files', '       (no text)'],
  })
  assert({
    given: 'an unavailable conversation',
    should: 'flag it with the raw id',
    actual: stripAnsi(
      renderDraftRow(row({ kind: 'unknown', label: 'C0GONE01', link: undefined }), 0, { hyperlinks: false }),
    )[0],
    expected: '    1. 2023-11-14 22:13  ⚠ unavailable conversation C0GONE01',
  })
  assert({
    given: 'a long body',
    should: 'cap the snippet',
    actual: stripAnsi(renderDraftRow(row({ text: 'x'.repeat(120) }), 0, { hyperlinks: false, maxSnippet: 10 }))[1],
    expected: `       ${'x'.repeat(9)}…`,
  })
})
