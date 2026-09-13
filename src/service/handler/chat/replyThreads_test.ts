import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { listDayChats, loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { splitContextLog } from '#shared/models/Chat/document/ContextLog/mod.ts'
import { createDomainResolvers } from '#shared/models/DomainCollection/query/resolvers/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
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
function reviewContent(messages: ReplyTestCall['messages'] = []): string {
  const pdfs = messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === 'file' && part.mediaType === 'application/pdf' && typeof part.data === 'string'
            ? [Buffer.from(part.data, 'base64').toString('utf8')]
            : [],
        )
      : [],
  )
  return [JSON.stringify(messages), ...pdfs].join('\n')
}
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
async function makeReply(app: App, owner: string, turn = 1): Promise<string> {
  const parent = await json(app, `/${owner}`)
  const response = await post(app, `/${owner}/replies`, parent.branchPoints[turn * 2 - 1])
  const body = (await response.json()) as { id: string; message?: string }
  if (!response.ok) throw new Error(body.message)
  return body.id
}

test('reply threads inherit the review and tools, isolate refinements, and persist with the parent', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-reply-contracts-'))
  const calls: ReplyTestCall[] = []
  try {
    const host = replyThreadTestHost(base, { calls })
    const app = createChatRoutes(host)
    const upload = new FormData()
    upload.set(
      'message',
      JSON.stringify({
        message: 'Review all five mock contracts.',
        profile: 'test-thread-model',
        effort: 'medium',
        contextTokens: 0,
        saves: true,
      }),
    )
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      const pdf = letter === 'E'
      const text = `Mock contract ${letter}\n\nThe shared term is Widget.`
      upload.append(
        'files',
        new File([pdf ? `%PDF-1.4\n${text}\n%%EOF` : `# ${text}`], `agreement-${letter}.${pdf ? 'pdf' : 'md'}`, {
          type: pdf ? 'application/pdf' : 'text/markdown',
        }),
      )
    }
    const accepted = await app.request('/main/messages', { method: 'POST', body: upload })
    const stream = await accepted.text()
    if (!stream.includes('event: turn')) throw new Error(stream)
    const original = await json(app, '/main')
    const point = original.branchPoints[1]
    const created = await Promise.all([post(app, '/main/replies', point), post(app, '/main/replies', point)])
    const ids = await Promise.all(created.map(async (response) => ((await response.json()) as { id: string }).id))
    const child = ids[0]!
    assert({
      given: 'a reply thread created from a chat with an effort override',
      should: 'inherit the override',
      actual: (await json(app, `/${child}/settings`)).effort,
      expected: 'medium',
    })
    assert({
      given: 'two clicks on the same reviewed response',
      should: 'open the same reply thread',
      actual: ids[0] === ids[1],
      expected: true,
    })
    await send(app, 'main', 'This later main-chat direction must stay outside the existing thread.')
    await send(app, child, 'Draft a response to the team from the five reviews.')
    await send(app, child, 'Make this draft warmer.')
    const childCall = calls.find((call) => call.id === child)!
    const childContext = reviewContent(childCall.messages)
    assert({
      given: 'a response thread after all five documents were reviewed in the main conversation',
      should: 'inherit file contents and review tool results through its source response only',
      actual: {
        contracts: ['A', 'B', 'C', 'D', 'E'].every((letter) => childContext.includes(`Mock contract ${letter}`)),
        reviewTool: childContext.includes('legal_review'),
        laterMain: childContext.includes('later main-chat direction'),
        mainUnchanged: (await json(app, '/main')).turns.length === 4,
        nested: (await post(app, `/${child}/replies`, point)).status,
        nestedFork: (await post(app, `/${child}/branch`, point)).status,
        listed: (await json(app, '/')).threads.map((row: { id: string }) => row.id),
      },
      expected: {
        contracts: true,
        reviewTool: true,
        laterMain: false,
        mainUnchanged: true,
        nested: 409,
        nestedFork: 409,
        listed: ['main'],
      },
    })
    const savedResponse = await post(app, '/main/end', { save: true })
    const saved = (await savedResponse.json()) as { saved: { path: string } }
    const files = await listDayChats(host.timeDir)
    const childFile = files.find((row) => row.parent?.kind === 'thread')!
    const childMarkdown = await readFile(childFile.path, 'utf8')
    const details = splitContextLog(childMarkdown).details!
    assert({
      given: 'saving the main conversation with a refined response thread',
      should: 'save its child under its own directory with only its own dialogue and usage',
      actual: {
        status: savedResponse.status,
        ownedPath: childFile.path.startsWith(`${saved.saved.path.replace(/\.md$/, '')}/_threads/`),
        parentInBody: splitContextLog(childMarkdown).body.includes('Review all five mock contracts.'),
        replies: details.statistics?.replies,
        input: details.statistics?.usage.input,
        tools: details.statistics?.tools.me_voice?.calls,
        retainsTools: JSON.stringify(details.session?.modelMessages).includes('legal_review'),
        rootInput: splitContextLog(await readFile(saved.saved.path, 'utf8')).details?.statistics?.usage.input,
        closed: (await json(app, '/')).threads.length,
      },
      expected: {
        status: 200,
        ownedPath: true,
        parentInBody: false,
        replies: 2,
        input: 160,
        tools: 2,
        retainsTools: true,
        rootInput: 160,
        closed: 0,
      },
    })
    const restarted = createChatRoutes(replyThreadTestHost(base, { calls }))
    const opened = (await (await post(restarted, '/open', { chat: path.relative(base, saved.saved.path) })).json()) as {
      id: string
    }
    const reopened = await makeReply(restarted, opened.id)
    assert({
      given: 'a saved reply thread reopened after restart',
      should: 'retain its effort override',
      actual: (await json(restarted, `/${reopened}/settings`)).effort,
      expected: 'medium',
    })
    const restored = await json(restarted, `/${reopened}`)
    await send(restarted, reopened, 'Keep the original review context and make the response shorter.')
    assert({
      given: 'a saved response thread opened after the service starts again',
      should: 'restore its revisions, specialist results, and file context',
      actual: {
        inherited: restored.inherited,
        messages: restored.turns.length,
        tools: restored.runs.some((run: { tool: string }) => run.tool === 'me_voice'),
        context: reviewContent(calls.at(-1)?.messages).includes('Mock contract E'),
        refinement: JSON.stringify(calls.at(-1)?.messages).includes('Make this draft warmer.'),
      },
      expected: { inherited: 2, messages: 6, tools: true, context: true, refinement: true },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('each fork owns its threads and recovery preserves that ownership', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-reply-branches-'))
  try {
    const host = replyThreadTestHost(base)
    const app = createChatRoutes(host)
    await send(app, 'main', 'Review the original set.')
    const parentReply = await makeReply(app, 'main')
    await send(app, parentReply, 'Draft the original response.')
    const point = (await json(app, '/main')).branchPoints[1]
    const branches: string[] = []
    for (const label of ['First', 'Second']) {
      const branch = (await (await post(app, '/main/branch', point)).json()) as { id: string }
      branches.push(branch.id)
      assert({
        given: 'a new fork',
        should: 'start without its parent’s threads',
        actual: (await json(app, `/${branch.id}/replies`)).threads.length,
        expected: 0,
      })
      await send(app, branch.id, `${label} alternate discussion.`)
      const reply = await makeReply(app, branch.id, 2)
      await send(app, reply, `${label} thread response.`)
      await post(app, `/${branch.id}/end`, { save: true })
    }
    const restored = createChatRoutes(replyThreadTestHost(base))
    const replies = (await json(restored, '/main/replies')).threads
    assert({
      given: 'the parent recovered while two forks and their threads are filed',
      should: 'show only the parent’s own thread',
      actual: replies.map((row: { id: string }) => row.id),
      expected: [parentReply],
    })
    const files = await listDayChats(host.timeDir)
    const replyFiles = files.filter((row) => row.parent?.kind === 'thread')
    assert({
      given: 'two saved branches with their own reply threads',
      should: 'place each thread beneath the directory matching its own parent file',
      actual: replyFiles.map((row) =>
        row.path.startsWith(`${path.join(base, row.parent!.chat).replace(/\.md$/, '')}/_threads/`),
      ),
      expected: [true, true],
    })
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [], timeDirs: [host.timeDir] })
    const rows = createDomainResolvers(store).chats({})
    const root = rows.find((row) => !row.parent)!
    assert({
      given: 'the saved family queried through GraphQL',
      should: 'distinguish actual forks from their response threads',
      actual: {
        branches: root.branches.length,
        rootThreads: root.replyThreads.length,
        branchThreads: rows.filter((row) => row.parent?.kind === 'branch').map((row) => row.replyThreads.length),
        nestedThreads: rows.filter((row) => row.parent?.kind === 'thread').map((row) => row.replyThreads.length),
      },
      expected: { branches: 2, rootThreads: 0, branchThreads: [1, 1], nestedThreads: [0, 0] },
    })
    await send(restored, parentReply, 'Continue after recovery.')
    assert({
      given: 'a recovered reply thread',
      should: 'keep its parent relationship and accept another refinement',
      actual: (await json(restored, `/${parentReply}`)).turns.length,
      expected: 6,
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('saving a recovered nested branch preserves the full ancestry and its response thread', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-reply-lineage-'))
  try {
    const host = replyThreadTestHost(base)
    const app = createChatRoutes(host)
    await send(app, 'main', 'Shared review context.')
    const point = (await json(app, '/main')).branchPoints[1]
    const branch = (await (await post(app, '/main/branch', point)).json()) as { id: string }
    await send(app, branch.id, 'Explore another interpretation.')
    const branchPoint = (await json(app, `/${branch.id}`)).branchPoints[3]
    const nested = (await (await post(app, `/${branch.id}/branch`, branchPoint)).json()) as { id: string }
    await send(app, nested.id, 'Settle the proposed response.')
    const reply = await makeReply(app, nested.id, 3)
    await send(app, reply, 'Draft the team response here.')

    const recovered = createChatRoutes(replyThreadTestHost(base))
    const saved = (await (await post(recovered, `/${nested.id}/end`, { save: true })).json()) as {
      saved: { path: string }
    }
    const files = await listDayChats(host.timeDir)
    const responseFile = files.find((row) => row.parent?.kind === 'thread')!
    const resumed = await loadResumeSession(responseFile.path, { baseDir: base })
    assert({
      given: 'two levels of unfiled branches recovered before the deepest branch is saved',
      should: 'file every ancestor at its original identity and reconstruct all context for its thread',
      actual: {
        files: files.length,
        owner: responseFile.parent?.chat === path.relative(base, saved.saved.path),
        messages: resumed.state.conversation.length,
        firstQuestion: resumed.state.conversation[0]?.content,
        inherited: resumed.inherited,
      },
      expected: { files: 4, owner: true, messages: 8, firstQuestion: 'Shared review context.', inherited: 6 },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a running specialist stays in its thread while the parent can continue', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-reply-running-'))
  let release!: () => void
  let started!: () => void
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const app = createChatRoutes(
      replyThreadTestHost(base, {
        wait: async (call) => {
          if (call.reply) {
            started()
            await wait
          }
        },
      }),
    )
    await send(app, 'main', 'Review the agreements.')
    const child = await makeReply(app, 'main')
    const working = send(app, child, 'Draft the response.')
    await began
    await send(app, 'main', 'Discuss a separate question here.')
    assert({
      given: 'a specialist working in the side conversation',
      should: 'keep its work there and protect it when the parent is saved',
      actual: {
        parentTurns: (await json(app, '/main')).turns.length,
        childBusy: (await json(app, `/${child}`)).busy,
        save: (await post(app, '/main/end', { save: true })).status,
        activity: (await json(app, '/main/replies')).threads[0].busy,
      },
      expected: { parentTurns: 4, childBusy: true, save: 409, activity: true },
    })
    release()
    await working
  } finally {
    release?.()
    await rm(base, { recursive: true, force: true })
  }
})
