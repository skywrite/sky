import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import EmailFollowRegistry from './EmailFollowRegistry.ts'

const EMAIL_YAML = `\
source: Email
ref:
  account: jp@example.com
  threadId: thread-abc123
  label: Sky/Follow
summary: FCA information request
followSince: 2026-03-22 09:00
lastActivity: 2026-03-22 10:30
status: active`

const SLACK_YAML = `\
source: Slack
ref:
  channel: C01
  thread_ts: "1.2"
status: active`

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'email-follow-registry-test-'))
}

async function writeYaml(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content, 'utf-8')
}

test('build() loads email follows from directory', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'email_one.yaml', EMAIL_YAML)

  const registry = await EmailFollowRegistry.build(dir)

  assert({ given: 'one email yaml', should: 'load it', expected: 1, actual: registry.size })

  await rm(dir, { recursive: true })
})

test('build() filters out non-email follows', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'email_one.yaml', EMAIL_YAML)
  await writeYaml(dir, 'slack_stray.yaml', SLACK_YAML)

  const registry = await EmailFollowRegistry.build(dir)

  assert({ given: 'one email and one slack yaml', should: 'load only email', expected: 1, actual: registry.size })

  await rm(dir, { recursive: true })
})

test('findByThreadId() returns matching follow', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'email_one.yaml', EMAIL_YAML)

  const registry = await EmailFollowRegistry.build(dir)
  const result = registry.findByThreadId('thread-abc123')

  assert({
    given: 'thread-abc123',
    should: 'find the follow',
    expected: 'FCA information request',
    actual: result?.follow.summary,
  })

  await rm(dir, { recursive: true })
})

test('findByThreadId() returns undefined for missing thread', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'email_one.yaml', EMAIL_YAML)

  const registry = await EmailFollowRegistry.build(dir)
  const result = registry.findByThreadId('does-not-exist')

  assert({ given: 'missing thread id', should: 'return undefined', expected: undefined, actual: result })

  await rm(dir, { recursive: true })
})

test('findByFileName() returns matching follow', async () => {
  const dir = await makeTempDir()
  await writeYaml(dir, 'email_one.yaml', EMAIL_YAML)

  const registry = await EmailFollowRegistry.build(dir)
  const result = registry.findByFileName('email_one')

  assert({
    given: 'file email_one.yaml',
    should: 'find by name without extension',
    expected: 'Email',
    actual: result?.follow.source,
  })

  await rm(dir, { recursive: true })
})

test('build() returns empty registry when directory does not exist', async () => {
  const dir = path.join(tmpdir(), 'email-follow-registry-test-missing-' + Date.now())

  const registry = await EmailFollowRegistry.build(dir)

  assert({ given: 'missing directory', should: 'return size 0', expected: 0, actual: registry.size })
})
