import { assert, test } from '#test'
import * as path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import FollowRegistry from './FollowRegistry.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const ACTIVE_YAML = `\
source: Slack
ref:
  channel: C01234ABC
  thread_ts: "1234567890.123456"
reason: Waiting for response
checkInterval: 5m
followSince: 2026-02-15 09:00
lastChecked: 2026-02-15 10:30
lastActivity: 2026-02-15 10:30
status: active`

const PAUSED_YAML = `\
source: Email
ref:
  messageId: msg-001
reason: On hold
checkInterval: 1h
status: paused`

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'follow-registry-test-'))
}

async function writeYaml(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content, 'utf-8')
}

test('build() loads all .yaml files from directory', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'slack_thread.yaml', ACTIVE_YAML)
  await writeYaml(dir, 'email_reply.yaml', PAUSED_YAML)

  const registry = await FollowRegistry.build(dir)

  assert({ given: 'two yaml files', should: 'load both', expected: 2, actual: registry.size })

  await rm(dir, { recursive: true })
})

test('build() skips non-yaml files', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'slack_thread.yaml', ACTIVE_YAML)
  await writeFile(path.join(dir, 'README.md'), '# Follows', 'utf-8')
  await writeFile(path.join(dir, 'notes.txt'), 'some notes', 'utf-8')

  const registry = await FollowRegistry.build(dir)

  assert({ given: 'one yaml and two non-yaml files', should: 'load only yaml', expected: 1, actual: registry.size })

  await rm(dir, { recursive: true })
})

test('build() collects errors for malformed files', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'good.yaml', ACTIVE_YAML)
  await writeYaml(dir, 'bad.yaml', 'source: Slack\nfollowSince: not-a-date')

  const registry = await FollowRegistry.build(dir)

  assert({ given: 'one good and one bad yaml', should: 'load the good one', expected: 1, actual: registry.size })
  assert({ given: 'one malformed file', should: 'collect one error', expected: 1, actual: registry.errors.length })

  await rm(dir, { recursive: true })
})

test('getActive() filters by status', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'active.yaml', ACTIVE_YAML)
  await writeYaml(dir, 'paused.yaml', PAUSED_YAML)

  const registry = await FollowRegistry.build(dir)
  const active = registry.getActive()

  assert({ given: 'one active and one paused', should: 'return only active', expected: 1, actual: active.length })
  assert({ given: 'active follow', should: 'be the Slack one', expected: 'Slack', actual: active[0].follow.source })

  await rm(dir, { recursive: true })
})

test('getDue() returns overdue follows', async () => {
  const dir = await makeTempDir()
  // lastChecked was 10:30, interval is 5m, so by 10:36 it's overdue
  await writeYaml(dir, 'overdue.yaml', ACTIVE_YAML)

  const registry = await FollowRegistry.build(dir)
  const now = PlainDateTime.fromString('2026-02-15 10:36')
  const due = registry.getDue(now)

  assert({
    given: 'follow checked at 10:30 with 5m interval',
    should: 'be due at 10:36',
    expected: 1,
    actual: due.length,
  })

  await rm(dir, { recursive: true })
})

test('getDue() skips follows that are not due yet', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'not-due.yaml', ACTIVE_YAML)

  const registry = await FollowRegistry.build(dir)
  // Only 2 minutes after last check (10:30), interval is 5m
  const now = PlainDateTime.fromString('2026-02-15 10:32')
  const due = registry.getDue(now)

  assert({
    given: 'follow checked at 10:30 with 5m interval',
    should: 'not be due at 10:32',
    expected: 0,
    actual: due.length,
  })

  await rm(dir, { recursive: true })
})

test('getDue() returns follows with no lastChecked', async () => {
  const dir = await makeTempDir()
  const neverChecked = `\
source: Slack
ref:
  channel: C999
reason: Never checked
checkInterval: 1h
status: active`
  await writeYaml(dir, 'never-checked.yaml', neverChecked)

  const registry = await FollowRegistry.build(dir)
  const now = PlainDateTime.fromString('2026-02-15 10:00')
  const due = registry.getDue(now)

  assert({ given: 'follow with no lastChecked', should: 'be due', expected: 1, actual: due.length })

  await rm(dir, { recursive: true })
})

test('findByFileName() returns matching follow', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'slack_sarah.yaml', ACTIVE_YAML)

  const registry = await FollowRegistry.build(dir)
  const result = registry.findByFileName('slack_sarah')

  assert({
    given: 'file slack_sarah.yaml',
    should: 'find by name without extension',
    expected: 'Slack',
    actual: result?.follow.source,
  })

  await rm(dir, { recursive: true })
})

test('findByFileName() returns undefined for missing name', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'slack_sarah.yaml', ACTIVE_YAML)

  const registry = await FollowRegistry.build(dir)
  const result = registry.findByFileName('nonexistent')

  assert({ given: 'nonexistent name', should: 'return undefined', expected: undefined, actual: result })

  await rm(dir, { recursive: true })
})
