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
