import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { assert, test } from '#test'
import { findCapturedThread } from './new.ts'

// A thread captured from the Later queue: enterprise-spelled root link,
// thread_ts recorded. Re-captures arrive under other spellings of the same
// thread and must land on this record.
const THREAD_YAML = `\
source: Slack
ref:
  channel: C0ATLAS0001
  thread_ts: "1750000000.000100"
  link: https://atlas.enterprise.slack.com/archives/C0ATLAS0001/p1750000000000100
summary: Widget rollout thread
checkInterval: 10m
followSince: 2026-02-15 09:00
status: active`

// A bare message captured before it had replies: no thread_ts, identity only
// in the link's p-ts.
const BARE_YAML = `\
source: Slack
ref:
  channel: C0ATLAS0002
  link: https://atlas.enterprise.slack.com/archives/C0ATLAS0002/p1750000000000200
summary: Bare message capture
checkInterval: 10m
followSince: 2026-02-15 09:00
status: active`

async function makeLedgers(): Promise<{ active: string; archive: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'slack-follow-new-test-'))
  return { active: path.join(base, 'active'), archive: path.join(base, 'archive') }
}

async function writeYaml(dir: string, name: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), content, 'utf-8')
}

async function find(link: string, dirs: { active: string; archive: string }) {
  return findCapturedThread(link, parseMessageLink(link), dirs)
}

test('findCapturedThread() matches a root link regardless of URL spelling', async () => {
  const dirs = await makeLedgers()
  await writeYaml(dirs.active, 'thread.yaml', THREAD_YAML)

  assert({
    given: 'a workspace-spelled root link into a thread captured under an enterprise spelling',
    should: 'find the active record by channel + root ts',
    expected: 'active:thread',
    actual: label(await find('https://atlas.slack.com/archives/C0ATLAS0001/p1750000000000100', dirs)),
  })
  assert({
    given: 'a root link to a different, uncaptured thread in the same channel',
    should: 'find nothing',
    expected: undefined,
    actual: label(await find('https://atlas.slack.com/archives/C0ATLAS0001/p1750000099000100', dirs)),
  })

  await rm(path.dirname(dirs.active), { recursive: true })
})

test('findCapturedThread() matches reply links that name their thread root', async () => {
  const dirs = await makeLedgers()
  await writeYaml(dirs.active, 'thread.yaml', THREAD_YAML)

  const reply = 'https://atlas.slack.com/archives/C0ATLAS0001/p1750000000999999'
  assert({
    given: 'a reply link carrying a thread_ts param',
    should: 'find the record by the named root',
    expected: 'active:thread',
    actual: label(await find(`${reply}?thread_ts=1750000000.000100&cid=C0ATLAS0001`, dirs)),
  })
  // A bare reply p-link names only its own ts — the pre-export check passes
  // it, and the post-export re-check supplies the root Slack resolved.
  assert({
    given: 'a bare reply p-link without a thread_ts param',
    should: 'find nothing from the link alone',
    expected: undefined,
    actual: label(await find(reply, dirs)),
  })
  assert({
    given: 'the same reply after the export resolved its true root',
    should: 'find the record',
    expected: 'active:thread',
    actual: label(await findCapturedThread(reply, { channelId: 'C0ATLAS0001', rootTs: '1750000000.000100' }, dirs)),
  })

  await rm(path.dirname(dirs.active), { recursive: true })
})

test('findCapturedThread() searches the archive when nothing is actively followed', async () => {
  const dirs = await makeLedgers()
  await writeYaml(dirs.archive, 'bare.yaml', BARE_YAML)

  assert({
    given: 'a differently spelled link to a bare message recorded only in the archive',
    should: 'find the archive record by the ts held in its stored link',
    expected: 'archive:bare',
    actual: label(await find('https://atlas.slack.com/archives/C0ATLAS0002/p1750000000000200', dirs)),
  })

  await rm(path.dirname(dirs.archive), { recursive: true })
})

test('findCapturedThread() falls back to exact link equality for unparseable links', async () => {
  const dirs = await makeLedgers()
  const unparseable = `\
source: Slack
ref:
  channel: C0ATLAS0003
  link: https://atlas.slack.com/client/T0ATLAS/C0ATLAS0003
summary: Client-view capture
checkInterval: 10m
status: active`
  await writeYaml(dirs.active, 'client-view.yaml', unparseable)

  assert({
    given: 'the exact stored link, in a form that names no message',
    should: 'match by string equality',
    expected: 'active:client-view',
    actual: label(await find('https://atlas.slack.com/client/T0ATLAS/C0ATLAS0003', dirs)),
  })
  assert({
    given: 'a different client-view link',
    should: 'find nothing',
    expected: undefined,
    actual: label(await find('https://atlas.slack.com/client/T0ATLAS/C0ATLAS0999', dirs)),
  })

  await rm(path.dirname(dirs.active), { recursive: true })
})

function label(hit: { ledger: string; fileName: string } | undefined): string | undefined {
  return hit ? `${hit.ledger}:${hit.fileName}` : undefined
}
