import { assert, test } from '#test'
import Follow from './mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const SLACK_YAML = `\
source: Slack
ref:
  channel: C01234ABC
  thread_ts: "1234567890.123456"
summary: Waiting for response from engineering
checkInterval: 5m
followSince: 2026-02-15 09:00
expires: 2026-02-22 09:00
lastChecked: 2026-02-15 10:30
status: active`

test('fromYaml() parses all fields', () => {
  const given = 'Slack YAML with all fields'
  const f = Follow.fromYaml(SLACK_YAML)

  assert({ given, should: 'parse source', expected: 'Slack', actual: f.source })
  assert({ given, should: 'parse ref.channel', expected: 'C01234ABC', actual: f.ref['channel'] })
  assert({
    given,
    should: 'parse ref.thread_ts',
    expected: '1234567890.123456',
    actual: f.ref['thread_ts'],
  })
  assert({
    given,
    should: 'parse summary',
    expected: 'Waiting for response from engineering',
    actual: f.summary,
  })
  assert({ given, should: 'parse checkInterval', expected: '5m', actual: f.checkInterval })
  assert({
    given,
    should: 'parse followSince',
    expected: '2026-02-15 09:00',
    actual: f.followSince?.toString(),
  })
  assert({
    given,
    should: 'parse expires',
    expected: '2026-02-22 09:00',
    actual: f.expires?.toString(),
  })
  assert({
    given,
    should: 'parse lastChecked',
    expected: '2026-02-15 10:30',
    actual: f.lastChecked?.toString(),
  })
  assert({ given, should: 'parse status', expected: 'active', actual: f.status })
})

test('toYaml() roundtrips correctly with key ordering', () => {
  const given = 'Follow parsed then serialized'
  const f = Follow.fromYaml(SLACK_YAML)
  const output = f.toYaml()

  // Verify key ordering: source should appear before ref, ref before summary, etc.
  const sourceIdx = output.indexOf('source:')
  const refIdx = output.indexOf('ref:')
  const summaryIdx = output.indexOf('summary:')
  const intervalIdx = output.indexOf('checkInterval:')
  const statusIdx = output.indexOf('status:')

  assert({ given, should: 'have source before ref', expected: true, actual: sourceIdx < refIdx })
  assert({ given, should: 'have ref before summary', expected: true, actual: refIdx < summaryIdx })
  assert({
    given,
    should: 'have summary before checkInterval',
    expected: true,
    actual: summaryIdx < intervalIdx,
  })
  assert({
    given,
    should: 'have checkInterval before status',
    expected: true,
    actual: intervalIdx < statusIdx,
  })

  // Roundtrip: re-parse the output and check fields match
  const f2 = Follow.fromYaml(output)
  assert({ given, should: 'roundtrip source', expected: f.source, actual: f2.source })
  assert({ given, should: 'roundtrip summary', expected: f.summary, actual: f2.summary })
  assert({
    given,
    should: 'roundtrip followSince',
    expected: f.followSince?.toString(),
    actual: f2.followSince?.toString(),
  })
  assert({
    given,
    should: 'roundtrip expires',
    expected: f.expires?.toString(),
    actual: f2.expires?.toString(),
  })
})

test('create() builds from typed fields with defaults', () => {
  const given = 'create() with all fields'
  const followSince = PlainDateTime.fromString('2026-02-15 09:00')
  const expires = PlainDateTime.fromString('2026-02-22 09:00')

  const f = Follow.create({
    source: 'Slack',
    ref: { channel: 'C999' },
    summary: 'Tracking thread',
    checkInterval: '1h',
    followSince,
    expires,
    status: 'paused',
  })

  assert({ given, should: 'set source', expected: 'Slack', actual: f.source })
  assert({ given, should: 'set ref', expected: 'C999', actual: f.ref['channel'] })
  assert({ given, should: 'set summary', expected: 'Tracking thread', actual: f.summary })
  assert({ given, should: 'set checkInterval', expected: '1h', actual: f.checkInterval })
  assert({
    given,
    should: 'set followSince',
    expected: '2026-02-15 09:00',
    actual: f.followSince?.toString(),
  })
  assert({
    given,
    should: 'set expires',
    expected: '2026-02-22 09:00',
    actual: f.expires?.toString(),
  })
  assert({ given, should: 'set status', expected: 'paused', actual: f.status })
})

test('create() with minimal fields defaults checkInterval to 10m', () => {
  const given = 'create() with minimal fields'

  const f = Follow.create({
    source: 'Email',
    ref: { messageId: 'abc123' },
    summary: 'Awaiting reply',
  })

  assert({ given, should: 'default checkInterval to 10m', expected: '10m', actual: f.checkInterval })
  assert({ given, should: 'default status to active', expected: 'active', actual: f.status })
  assert({ given, should: 'have no expires', expected: undefined, actual: f.expires })
  assert({ given, should: 'have no followSince', expected: undefined, actual: f.followSince })
  assert({ given, should: 'have no lastChecked', expected: undefined, actual: f.lastChecked })
})

test('updateLastChecked() returns new instance, does not mutate original', () => {
  const given = 'updateLastChecked() called'
  const original = Follow.create({
    source: 'Slack',
    ref: { channel: 'C01' },
    summary: 'test',
  })

  const dt = PlainDateTime.fromString('2026-02-15 14:30')
  const updated = original.updateLastChecked(dt)

  assert({
    given,
    should: 'return new instance with updated lastChecked',
    expected: '2026-02-15 14:30',
    actual: updated.lastChecked?.toString(),
  })
  assert({
    given,
    should: 'not mutate original',
    expected: undefined,
    actual: original.lastChecked,
  })
  assert({
    given,
    should: 'preserve other fields',
    expected: 'Slack',
    actual: updated.source,
  })
})

test('updateStatus() returns new instance, does not mutate original', () => {
  const given = 'updateStatus() called'
  const original = Follow.create({
    source: 'iMessage',
    ref: { handle: '+1234567890' },
    summary: 'test',
  })

  const updated = original.updateStatus('paused')

  assert({
    given,
    should: 'return new instance with updated status',
    expected: 'paused',
    actual: updated.status,
  })
  assert({
    given,
    should: 'not mutate original',
    expected: 'active',
    actual: original.status,
  })
  assert({
    given,
    should: 'preserve other fields',
    expected: 'iMessage',
    actual: updated.source,
  })
})

test('fromYaml() handles missing optional fields gracefully', () => {
  const given = 'YAML with only required fields'
  const yaml = `\
source: Email
ref:
  messageId: msg-001
summary: Waiting for approval
status: active`

  const f = Follow.fromYaml(yaml)

  assert({ given, should: 'parse source', expected: 'Email', actual: f.source })
  assert({ given, should: 'parse summary', expected: 'Waiting for approval', actual: f.summary })
  assert({ given, should: 'default checkInterval', expected: '10m', actual: f.checkInterval })
  assert({ given, should: 'have no followSince', expected: undefined, actual: f.followSince })
  assert({ given, should: 'have no expires', expected: undefined, actual: f.expires })
  assert({ given, should: 'have no lastChecked', expected: undefined, actual: f.lastChecked })
})

test('inactivityMs() anchors on last message date, then lastActivity/followSince', () => {
  const given = 'follows with different activity anchors'
  const now = PlainDateTime.fromString('2026-03-01 12:00')
  const DAY = 86_400_000
  const HOUR = 3_600_000

  const withMsg = Follow.create({
    source: 'Slack',
    ref: {},
    summary: 'msg anchor',
    lastActivity: PlainDateTime.fromString('2026-01-01 00:00'),
    messages: [{ date: '2026-02-27', path: 'time/2026/02/23-01/27/msg.md' }],
  })
  assert({
    given,
    should: 'prefer last message date (day granularity) over lastActivity',
    expected: 2 * DAY,
    actual: withMsg.inactivityMs(now),
  })

  const withActivity = Follow.create({
    source: 'Slack',
    ref: {},
    summary: 'activity anchor',
    lastActivity: PlainDateTime.fromString('2026-02-27 06:00'),
  })
  assert({
    given,
    should: 'fall back to lastActivity when no messages',
    expected: 2 * DAY + 6 * HOUR,
    actual: withActivity.inactivityMs(now),
  })

  const withSince = Follow.create({
    source: 'Slack',
    ref: {},
    summary: 'since anchor',
    followSince: PlainDateTime.fromString('2026-03-01 02:00'),
  })
  assert({
    given,
    should: 'fall back to followSince when no lastActivity',
    expected: 10 * HOUR,
    actual: withSince.inactivityMs(now),
  })

  const bare = Follow.create({ source: 'Slack', ref: {}, summary: 'no anchor' })
  assert({
    given,
    should: 'return Infinity when no anchor exists',
    expected: Infinity,
    actual: bare.inactivityMs(now),
  })
})

test('isExpired() honors an explicit expires deadline over activity', () => {
  const given = 'follow with explicit expires'
  const f = Follow.create({
    source: 'Slack',
    ref: {},
    summary: 'deadline',
    messages: [{ date: '2026-02-28', path: 'time/2026/02/23-01/28/msg.md' }],
    expires: PlainDateTime.fromString('2026-03-01 09:00'),
  })

  assert({
    given,
    should: 'not be expired before the deadline',
    expected: false,
    actual: f.isExpired(PlainDateTime.fromString('2026-03-01 08:59')),
  })
  assert({
    given,
    should: 'be expired at the deadline despite recent activity',
    expected: true,
    actual: f.isExpired(PlainDateTime.fromString('2026-03-01 09:00')),
  })

  const slow = Follow.create({
    source: 'Slack',
    ref: {},
    summary: 'slow thread',
    messages: [{ date: '2025-12-01', path: 'time/2025/12/01-07/01/msg.md' }],
    expires: PlainDateTime.fromString('2026-06-01 09:00'),
  })
  assert({
    given,
    should: 'let a future expires keep a long-inactive follow alive',
    expected: false,
    actual: slow.isExpired(PlainDateTime.fromString('2026-03-01 12:00')),
  })
})

test('isExpired() falls back to the inactivity window when no expires is set', () => {
  const given = 'follow without expires'
  const now = PlainDateTime.fromString('2026-03-01 12:00')
  const withLastMsg = (date: string) =>
    Follow.create({
      source: 'Slack',
      ref: {},
      summary: 'inactivity',
      messages: [{ date, path: 'time/msg.md' }],
    })

  assert({
    given,
    should: 'stay alive under the default window (9d < 14d)',
    expected: false,
    actual: withLastMsg('2026-02-20').isExpired(now),
  })
  assert({
    given,
    should: 'expire past the default window (15d >= 14d)',
    expected: true,
    actual: withLastMsg('2026-02-14').isExpired(now),
  })
  assert({
    given,
    should: 'respect a custom window (9d >= 7d)',
    expected: true,
    actual: withLastMsg('2026-02-20').isExpired(now, '7d'),
  })
  assert({
    given,
    should: 'expire when no activity anchor exists at all',
    expected: true,
    actual: Follow.create({ source: 'Slack', ref: {}, summary: 'bare' }).isExpired(now),
  })
})
