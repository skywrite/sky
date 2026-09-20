import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createChatRoutes } from './mod.ts'
import { replyThreadTestHost, type ReplyTestCall } from './replyThreadsTestHelpers.ts'

type App = ReturnType<typeof createChatRoutes>
const json = async (app: App, url: string) => (await app.request(url)).json() as Promise<any>
const post = (app: App, url: string, body: unknown) =>
  app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
async function send(app: App, id: string, message: string) {
  const settings = await json(app, `/${id}/settings`)
  const response = await post(app, `/${id}/messages`, {
    message,
    profile: settings.model.current,
    effort: settings.effort,
    contextTokens: settings.contextTokens,
    saves: settings.saves,
  })
  const body = await response.text()
  if (!response.ok || !body.includes('event: turn')) throw new Error(`Message failed: ${body}`)
}
/** Keep the thread through reply `turn`, with the key the page would have read for it. */
async function unwind(app: App, id: string, turn: number) {
  const key = turn > 0 ? (await json(app, `/${id}`)).branchPoints[turn * 2 - 1]?.key : undefined
  const response = await post(app, `/${id}/unwind`, { turn, key })
  return { status: response.status, body: (await response.json()) as any }
}
const snapshotsOf = async (base: string) => {
  const dir = path.join(base, 'state')
  const names = await readdir(dir).catch(() => [] as string[])
  return Promise.all(names.map((name) => readFile(path.join(dir, name), 'utf8')))
}
const said = (call: ReplyTestCall | undefined) => JSON.stringify(call?.messages ?? [])

test('deleting from a question cuts the thread, its records, and its snapshot', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-cut-'))
  const calls: ReplyTestCall[] = []
  try {
    const app = createChatRoutes(replyThreadTestHost(base, { calls }))
    await send(app, 'main', 'Plan the Atlas launch.')
    await send(app, 'main', 'Draft the Atlas announcement.')
    await send(app, 'main', 'Post the Atlas announcement.')
    const before = await json(app, '/main')
    const cut = await unwind(app, 'main', 1)
    const after = await json(app, '/main')
    const [snapshot] = await snapshotsOf(base)
    assert({
      given: 'a delete from the second of three questions',
      should: 'keep the first exchange alone, with only its runs, usage, timings and queries',
      actual: {
        before: [before.turns.length, before.runs.length, before.usage.length],
        answer: [cut.status, cut.body.turns],
        turns: after.turns.map((turn: { content: string }) => turn.content.slice(0, 22)),
        runsAt: after.runs.map((run: { at: number }) => run.at),
        usageAt: after.usage.map((row: { at: number }) => row.at),
        timingsAt: after.timings.map((row: { at: number }) => row.at),
        queryTurns: after.queries.map((row: { turn: number }) => row.turn),
        busy: after.busy,
      },
      expected: {
        before: [6, 3, 3],
        answer: [200, 2],
        turns: ['Plan the Atlas launch.', 'All five agreements ha'],
        runsAt: [1],
        usageAt: [1],
        timingsAt: [1],
        queryTurns: [1],
        busy: false,
      },
    })
    assert({
      given: 'the recovery snapshot after the delete',
      should: 'hold the kept question and none of the deleted ones',
      actual: {
        files: (await snapshotsOf(base)).length,
        kept: snapshot?.includes('Plan the Atlas launch.'),
        second: snapshot?.includes('Draft the Atlas announcement.'),
        third: snapshot?.includes('Post the Atlas announcement.'),
      },
      expected: { files: 1, kept: true, second: false, third: false },
    })
    await send(app, 'main', 'Ask about Atlas pricing instead.')
    assert({
      given: 'the next message after a delete',
      should: 'reach the model with the kept exchange and without the deleted questions',
      actual: {
        kept: said(calls.at(-1)).includes('Plan the Atlas launch.'),
        keptToolResult: said(calls.at(-1)).includes('legal_review'),
        deleted: said(calls.at(-1)).includes('Draft the Atlas announcement.'),
        turns: (await json(app, '/main')).turns.length,
      },
      expected: { kept: true, keptToolResult: true, deleted: false, turns: 4 },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('deleting from the first question leaves the id its tuning and nothing else', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-all-'))
  try {
    const app = createChatRoutes(replyThreadTestHost(base))
    await send(app, 'main', 'Plan the Atlas launch.')
    await post(app, '/main/settings', { saves: false })
    const cut = await unwind(app, 'main', 0)
    assert({
      given: 'a delete from the first question of a thread set not to save',
      should: 'remove the thread and its snapshot, and keep the choice made for the id',
      actual: {
        answer: [cut.status, cut.body.turns],
        thread: (await app.request('/main')).status,
        listed: (await json(app, '/')).threads.length,
        snapshots: (await snapshotsOf(base)).length,
        saves: (await json(app, '/main/settings')).saves,
      },
      expected: { answer: [200, 0], thread: 404, listed: 0, snapshots: 0, saves: false },
    })
    await send(app, 'main', 'Start over on Atlas.')
    assert({
      given: 'a message on the emptied id',
      should: 'begin a new conversation there',
      actual: (await json(app, '/main')).turns.map((turn: { content: string }) => turn.content.slice(0, 20)),
      expected: ['Start over on Atlas.', 'All five agreements '],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a delete is refused when the page is stale, nothing follows, or a turn is running', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-refuse-'))
  let started = () => {}
  let finish = () => {}
  const began = new Promise<void>((resolve) => (started = resolve))
  const wait = new Promise<void>((resolve) => (finish = resolve))
  let holding = false
  try {
    const app = createChatRoutes(
      replyThreadTestHost(base, {
        wait: async () => {
          if (!holding) return
          started()
          await wait
        },
      }),
    )
    await send(app, 'main', 'Plan the Atlas launch.')
    await send(app, 'main', 'Draft the Atlas announcement.')
    const stale = await post(app, '/main/unwind', { turn: 1, key: 'a-key-from-an-older-page' })
    const nothing = await unwind(app, 'main', 2)
    holding = true
    const working = send(app, 'main', 'Post the Atlas announcement.')
    await began
    const running = await unwind(app, 'main', 1)
    finish()
    await working
    assert({
      given: 'deletes that must not happen',
      should: 'refuse each in words and leave the thread whole',
      actual: {
        unknown: (await post(app, '/nowhere/unwind', { turn: 0 })).status,
        badTurn: (await post(app, '/main/unwind', { turn: -1 })).status,
        stale: [stale.status, ((await stale.json()) as { message: string }).message.includes('no longer matches')],
        nothing: [nothing.status, nothing.body.message],
        running: [running.status, running.body.message],
        turns: (await json(app, '/main')).turns.length,
      },
      expected: {
        unknown: 409,
        badTurn: 400,
        stale: [409, true],
        nothing: [409, 'There is nothing after this point to delete.'],
        running: [409, 'a turn is still running on this thread'],
        turns: 6,
      },
    })
  } finally {
    finish()
    await rm(base, { recursive: true, force: true })
  }
})

test('a branch or reply thread still open after the point blocks the delete', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-blocked-'))
  try {
    const app = createChatRoutes(replyThreadTestHost(base))
    await send(app, 'main', 'Plan the Atlas launch.')
    await send(app, 'main', 'Draft the Atlas announcement.')
    await send(app, 'main', 'Post the Atlas announcement.')
    const points = (await json(app, '/main')).branchPoints
    const branch = ((await (await post(app, '/main/branch', points[3])).json()) as { id: string }).id
    const blocked = await unwind(app, 'main', 1)
    const allowed = await unwind(app, 'main', 2)
    const reply = ((await (await post(app, '/main/replies', points[3])).json()) as { id: string }).id
    const byThread = await unwind(app, 'main', 1)
    await post(app, `/${branch}/end`, { save: false })
    await post(app, `/${reply}/end`, { save: false })
    const cleared = await unwind(app, 'main', 1)
    assert({
      given: 'a branch made from the second reply, then a reply thread on it',
      should: 'block a delete before that reply, naming what is open, and allow one at it or once they are gone',
      actual: {
        blocked: [blocked.status, blocked.body.blockedBy, blocked.body.message.includes('A branch left after')],
        allowed: [allowed.status, allowed.body.turns],
        byThread: [
          byThread.status,
          byThread.body.blockedBy.map((row: { kind: string }) => row.kind).sort(),
          byThread.body.message.includes('Discard it first'),
        ],
        cleared: [cleared.status, cleared.body.turns],
        branchKept: (await app.request(`/${branch}`)).status,
      },
      expected: {
        blocked: [409, [{ id: branch, title: null, kind: 'branch' }], true],
        allowed: [200, 4],
        byThread: [409, ['branch', 'thread'], true],
        cleared: [200, 2],
        branchKept: 404,
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('turns already in the notebook file stay, and the rest still delete and save', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-saved-'))
  try {
    const app = createChatRoutes(replyThreadTestHost(base))
    await send(app, 'main', 'Plan the Atlas launch.')
    await send(app, 'main', 'Draft the Atlas announcement.')
    const filed = ((await (await post(app, '/main/end', { save: true })).json()) as { saved: { path: string } }).saved
    const chat = path.relative(base, filed.path)
    const id = ((await (await post(app, '/open', { chat })).json()) as { id: string }).id
    await send(app, id, 'Post the Atlas announcement.')
    await send(app, id, 'Price the Atlas plans.')
    const fixed = (await json(app, `/${id}`)).fixed
    const saved = await unwind(app, id, 1)
    const unsaved = await unwind(app, id, 3)
    const closed = (await (await post(app, `/${id}/end`, { save: true })).json()) as {
      saved: { aborted?: unknown; exchanges: number } | null
    }
    const file = await readFile(filed.path, 'utf8')
    assert({
      given: 'a saved chat continued for two more turns',
      should: 'refuse a delete inside the file, delete the unsaved last turn, and save the rest through the gate',
      actual: {
        fixed,
        saved: [saved.status, saved.body.message],
        unsaved: [unsaved.status, unsaved.body.turns],
        aborted: closed.saved?.aborted ?? null,
        exchanges: closed.saved?.exchanges,
        third: file.includes('Post the Atlas announcement.'),
        fourth: file.includes('Price the Atlas plans.'),
      },
      expected: {
        fixed: 4,
        saved: [409, 'Those turns are already saved to your notebook. Delete from a later question.'],
        unsaved: [200, 6],
        aborted: null,
        exchanges: 3,
        third: true,
        fourth: false,
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a branch deletes its own turns and never the ones it inherited', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-branch-'))
  try {
    const app = createChatRoutes(replyThreadTestHost(base))
    await send(app, 'main', 'Plan the Atlas launch.')
    const point = (await json(app, '/main')).branchPoints[1]
    const branch = ((await (await post(app, '/main/branch', point)).json()) as { id: string }).id
    await send(app, branch, 'Take the Atlas plan another way.')
    const inherited = await unwind(app, branch, 0)
    const own = await unwind(app, branch, 1)
    const after = await json(app, `/${branch}`)
    assert({
      given: 'a branch with one turn of its own',
      should: 'refuse to delete the inherited exchange and delete its own, staying a branch',
      actual: {
        fixed: after.fixed,
        inherited: [inherited.status, inherited.body.message],
        own: [own.status, own.body.turns],
        parent: [after.parent?.id, after.parent?.turn, after.inherited],
        mainTurns: (await json(app, '/main')).turns.length,
      },
      expected: {
        fixed: 2,
        inherited: [409, 'Those turns belong to the chat this one left. Delete from a later question.'],
        own: [200, 2],
        parent: ['main', 1, 2],
        mainTurns: 2,
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a thread that began with a draft linked is emptied, never dropped', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-unwind-draft-'))
  const linked: unknown[] = []
  try {
    const host = replyThreadTestHost(base, {
      tools: async (hooks) => {
        linked.push(hooks.writingDrafts?.list())
        return { tools: {}, toolApproval: {} }
      },
    })
    // A draft's own discussion thread: no messages yet, its draft linked before the first.
    const app = createChatRoutes({
      ...host,
      snapshots: async () => [
        {
          id: 'draft-atlas',
          title: 'Draft to Jane',
          state: {
            conversation: [],
            universePaths: [],
            queries: [],
            lastTurn: 0,
            contextLog: [],
            writingDrafts: [{ id: 'atlas-note', turn: 0 }],
            writingDraftFocus: 'atlas-note',
          },
        },
      ],
    })
    await send(app, 'draft-atlas', 'Make the Atlas note warmer.')
    const cut = await unwind(app, 'draft-atlas', 0)
    const after = await app.request('/draft-atlas')
    await send(app, 'draft-atlas', 'Make the Atlas note shorter.')
    assert({
      given: 'a delete from the first question of a draft discussion',
      should: 'keep the thread, empty, with its draft still linked for the next turn',
      actual: {
        answer: [cut.status, cut.body.turns],
        thread: [after.status, ((await after.json()) as { turns: unknown[] }).turns.length],
        toolBuilds: linked.length,
        linkedAfter: linked.at(-1),
        turns: (await json(app, '/draft-atlas')).turns.length,
      },
      expected: {
        answer: [200, 0],
        thread: [200, 0],
        toolBuilds: 2,
        linkedAfter: [{ id: 'atlas-note', turn: 0 }],
        turns: 2,
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
