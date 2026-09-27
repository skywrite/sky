import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import type { pollSlackFollow } from '#commands/all/slack/lib/pollFollow.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { findCapturedThread, refreshCapturedThread } from './mod.ts'

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

// A merged conversation: the record owns its ref root AND every merged anchor.
const MERGED_YAML = `\
source: Slack
ref:
  channel: C0ATLAS0009
  thread_ts: "1750000001.000001"
  link: https://atlas.slack.com/archives/C0ATLAS0009/p1750000001000001
merged:
  - channel: C0ATLAS0009
    thread_ts: "1750000002.000002"
    link: https://atlas.enterprise.slack.com/archives/C0ATLAS0009/p1750000002000002
summary: Merged widget conversation
checkInterval: 10m
followSince: 2026-02-15 09:00
status: active`

async function find(link: string, dirs: { active: string; archive: string }) {
  return findCapturedThread(link, parseMessageLink(link), dirs)
}

test('findCapturedThread() matches merged anchors, any spelling', async () => {
  const dirs = await makeLedgers()
  await writeYaml(dirs.active, 'merged.yaml', MERGED_YAML)

  assert({
    given: 'a workspace-spelled root link to a merged anchor',
    should: 'find the merged record',
    expected: 'active:merged',
    actual: label(await find('https://atlas.slack.com/archives/C0ATLAS0009/p1750000002000002', dirs)),
  })
  assert({
    given: 'a reply link naming a merged anchor as its thread root',
    should: 'find the merged record',
    expected: 'active:merged',
    actual: label(
      await find(
        'https://atlas.slack.com/archives/C0ATLAS0009/p1750000002999999?thread_ts=1750000002.000002&cid=C0ATLAS0009',
        dirs,
      ),
    ),
  })
  assert({
    given: 'an uncaptured root in the same channel',
    should: 'find nothing',
    expected: undefined,
    actual: label(await find('https://atlas.slack.com/archives/C0ATLAS0009/p1750000009000009', dirs)),
  })

  await rm(path.dirname(dirs.active), { recursive: true })
})

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

// A thread captured weeks ago whose follow expired into the archive.
const QUIET_YAML = `\
source: Slack
ref:
  channel: C0ATLAS0004
  link: https://atlas.slack.com/archives/C0ATLAS0004/p1750000000000400
summary: Widget rollout thread
checkInterval: 12h
followSince: 2026-03-10 09:00
lastChecked: 2026-03-24 09:00
lastActivity: 2026-03-10 09:05
messages:
  - date: 2026-03-10
    path: 2026-03-10/actions/messages/09-00_slack_Jane-Doe-to-atlas_Widget-rollout.md
status: closed`

const NOW = new PlainDateTime('2026-04-26 10:00')
const replyRef = (date: string) => `${date}/actions/messages/19-41_slack_Jane-Doe-to-atlas_Widget-rollout.md`

/** A poll that saves one reply on `date`, the way the real poll files it on its own day */
const savesReplyOn =
  (date: string): typeof pollSlackFollow =>
  async (entry) => ({
    ok: true,
    follow: entry.follow.withMessages([...entry.follow.messages, { date, path: replyRef(date) }]),
    newReplies: 1,
    written: [replyRef(date)],
  })

const quiet: typeof pollSlackFollow = async (entry) => ({
  ok: true,
  follow: entry.follow,
  newReplies: 0,
  written: [],
})

async function refreshFixture(yaml = QUIET_YAML, ledger: 'active' | 'archive' = 'archive') {
  const dirs = await makeLedgers()
  await writeYaml(dirs[ledger], 'quiet.yaml', yaml)
  const hit = {
    fileName: 'quiet',
    path: path.join(dirs[ledger], 'quiet.yaml'),
    summary: 'Widget rollout thread',
    ledger,
  }
  const refresh = (poll: typeof pollSlackFollow, expires?: PlainDateTime) =>
    refreshCapturedThread(hit, {
      tasks: {} as unknown as CommandService,
      output: { log: () => {} } as unknown as OutputHandler,
      now: NOW,
      poll,
      expires,
      activeDir: dirs.active,
    })
  const active = path.join(dirs.active, 'quiet.yaml')
  const record = async (file: string) => Follow.fromYaml(await readFile(file, 'utf-8'))
  const cleanup = () => rm(path.dirname(dirs.active), { recursive: true })
  return { hit, refresh, active, record, cleanup }
}

test('refreshCapturedThread() saves a revived archived thread and follows it again', async () => {
  const f = await refreshFixture()
  const result = await f.refresh(savesReplyOn('2026-04-24'))

  assert({
    given: 'a link into an archived thread whose new reply landed two days ago',
    should: 'return the saved reply and the reopened record',
    actual: { ok: result.ok, data: result.data },
    expected: {
      ok: true,
      data: { file: f.active, followed: true, slackFiles: [resolveTimeRef(replyRef('2026-04-24'))] },
    },
  })
  assert({
    given: 'the same refresh',
    should: 'move the record from the archive to the active ledger',
    actual: { archived: await exists(f.hit.path), status: (await f.record(f.active)).status },
    expected: { archived: false, status: 'active' },
  })

  await f.cleanup()
})

test('refreshCapturedThread() keeps a thread still quiet past the window archived', async () => {
  const f = await refreshFixture()
  const result = await f.refresh(savesReplyOn('2026-04-01'))

  assert({
    given: 'an archived thread whose only new reply is itself older than the expiry window',
    should: 'return the saved reply without following the thread',
    actual: { ok: result.ok, data: result.data, archived: await exists(f.hit.path), active: await exists(f.active) },
    expected: {
      ok: true,
      data: { file: f.hit.path, followed: false, slackFiles: [resolveTimeRef(replyRef('2026-04-01'))] },
      archived: true,
      active: false,
    },
  })

  await f.cleanup()
})

test('refreshCapturedThread() drops a lapsed deadline when it reopens a thread', async () => {
  const lapsed = `${QUIET_YAML}\nexpires: 2026-03-20 09:00`

  const f = await refreshFixture(lapsed)
  await f.refresh(savesReplyOn('2026-04-24'))
  assert({
    given: 'an archived follow whose explicit deadline passed, revived without a new one',
    should: 'follow it again under the inactivity window',
    actual: (await f.record(f.active)).expires,
    expected: undefined,
  })
  await f.cleanup()

  const g = await refreshFixture(lapsed)
  await g.refresh(savesReplyOn('2026-04-24'), new PlainDateTime('2026-05-10 23:59'))
  assert({
    given: 'the same revival with a new --expires',
    should: 'carry the new deadline',
    actual: (await g.record(g.active)).expires?.toString(),
    expected: new PlainDateTime('2026-05-10 23:59').toString(),
  })
  await g.cleanup()
})

test('refreshCapturedThread() declines as before when nothing is new', async () => {
  const f = await refreshFixture()
  const archived = await f.refresh(quiet)
  assert({
    given: 'an archived thread with nothing new in Slack',
    should: 'decline as already captured and leave the record archived',
    actual: { ok: archived.ok, message: archived.message, archived: await exists(f.hit.path) },
    expected: { ok: false, message: 'Already captured: quiet', archived: true },
  })
  await f.cleanup()

  const g = await refreshFixture(QUIET_YAML.replace('status: closed', 'status: active'), 'active')
  const followed = await g.refresh(quiet)
  assert({
    given: 'an actively followed thread with nothing new in Slack',
    should: 'decline as a duplicate follow',
    actual: { ok: followed.ok, message: followed.message },
    expected: { ok: false, message: 'Duplicate follow: quiet' },
  })
  await g.cleanup()
})

test('refreshCapturedThread() reports a failed poll instead of throwing', async () => {
  const f = await refreshFixture()
  const gone = await f.refresh(async () => ({
    ok: false,
    failures: [
      {
        link: 'https://atlas.slack.com/archives/C0ATLAS0004/p1750000000000400',
        message: 'agent-slack message get failed: Message not found (no access or wrong URL)',
      },
    ],
  }))
  assert({
    given: 'a thread Slack no longer serves',
    should: 'fail with the export message the Later queue treats as deleted',
    actual: { ok: gone.ok, notFound: gone.message?.includes('Message not found') },
    expected: { ok: false, notFound: true },
  })

  const broken = await f.refresh(async () => {
    throw new Error('Simulated save failure')
  })
  assert({
    given: 'a poll whose save throws',
    should: 'fail this link so a batch can move on to the next',
    actual: { ok: broken.ok, message: broken.message },
    expected: { ok: false, message: 'Failed to update quiet: Simulated save failure' },
  })

  await f.cleanup()
})
