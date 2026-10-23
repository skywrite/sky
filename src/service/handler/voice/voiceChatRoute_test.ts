import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { tool } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import { createChatFileTools } from '#commands/lib/chat/localFileTools.ts'
import { voiceSessionConfig } from '#commands/lib/voice/sessionConfig.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { FILE_CHAT_REPLY, fileChatHost } from '../chat/filesTestHelpers.ts'
import { createChatRoutes } from '../chat/mod.ts'
import { readSession } from '../chat/readSession.ts'
import { voiceConversation } from '../chat/voiceTranscript.ts'
import { voiceChatTools } from './chatTools.ts'
import { APPROVAL_TOOLS, createVoiceRoutes, type VoiceToolOutput } from './mod.ts'

const prefs = { profile: 'test', effort: 'default' as const, contextTokens: 0, saves: true }
const spoken = [{ who: 'you' as const, text: 'Read the Atlas document and keep a draft.' }]
const post = (app: Hono, url: string, body: unknown = {}) =>
  app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

test('an abandoned voice call keeps its checkpoint before the next text reply and through recovery', async () => {
  const root = await makeTempDir({ prefix: 'sky-voice-recovery-' })
  try {
    const fixture = fileChatHost(root)
    const chat = createChatRoutes(fixture.host)
    await (await post(chat, '/atlas/messages', { message: 'Discuss Atlas.', ...prefs })).text()
    const lifetime = new AbortController()
    const lease = await chat.openVoice({ id: 'atlas', after: 2, ...prefs }, lifetime.signal)
    const turns = [
      { who: 'you' as const, text: 'Check the Atlas outline.' },
      { who: 'sky' as const, text: 'The outline has three sections.' },
      { who: 'you' as const, text: 'Keep the evidence section.' },
    ]
    await lease.build(turns)
    lease.record(
      {
        type: 'tool-execution-end',
        toolCallId: 'atlas-read',
        toolName: 'read_file',
        output: 'Synthetic Atlas source receipt.',
        finished: 1000,
      },
      turns,
    )
    // The browser disappeared: the service releases its lease, but no final transcript is posted.
    lifetime.abort()
    await lease.close()
    await lease.close()
    const visible = (await (await chat.request('/atlas')).json()) as { turns: unknown[]; busy: boolean }
    const checkpoint = await readSession(fixture.snapshotPath('atlas'), { baseDir: root, snapshot: true })
    assert({
      given: 'a closed call whose browser never delivered its final transcript',
      should: 'show the checkpoint in the active chat and keep it once in recovery',
      actual: [
        visible.busy,
        visible.turns.length,
        checkpoint.state.conversation.slice(2).map(({ content }) => content),
      ],
      expected: [false, 5, voiceConversation(turns).map(({ content }) => content)],
    })
    await (await post(chat, '/atlas/messages', { message: 'Continue in text.', ...prefs })).text()
    const late = await post(chat, '/atlas/voice', {
      after: 2,
      turns: [...turns, { who: 'sky', text: 'The evidence section is kept.' }],
      ...prefs,
    })
    const continued = await readSession(fixture.snapshotPath('atlas'), { baseDir: root, snapshot: true })
    const history = JSON.stringify(fixture.calls.at(-1))
    const expected = [
      'Discuss Atlas.',
      FILE_CHAT_REPLY,
      'Check the Atlas outline.',
      'Sky: The outline has three sections.',
      'Keep the evidence section.\n\nContinue in text.',
      FILE_CHAT_REPLY,
    ]
    assert({
      given: 'a typed follow-up after losing the voice browser',
      should: 'use spoken intent and tool receipts and never append an old checkpoint after the new reply',
      actual: [
        late.status,
        history.includes('Check the Atlas outline.'),
        history.includes('Keep the evidence section.'),
        history.includes('Synthetic Atlas source receipt.'),
        continued.state.conversation.map(({ content }) => content),
      ],
      expected: [409, true, true, true, expected],
    })
    const restored = createChatRoutes(
      fileChatHost(root, [
        { id: 'atlas', startTime: fixture.sessions.get('atlas')!.startTime, state: continued.state, prefs },
      ]).host,
    )
    const recovered = (await (await restored.request('/atlas')).json()) as { turns: { content: string }[] }
    assert({
      given: 'a later service restart',
      should: 'restore the same conversation in chronological order',
      actual: recovered.turns.map(({ content }) => content),
      expected,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a final voice transcript completes the recovered checkpoint but cannot replace newer text', async () => {
  const root = await makeTempDir({ prefix: 'sky-voice-handoff-' })
  try {
    const fixture = fileChatHost(root)
    const chat = createChatRoutes(fixture.host)
    const lifetime = new AbortController()
    const lease = await chat.openVoice({ id: 'atlas', after: 0, ...prefs }, lifetime.signal)
    await lease.build([
      { who: 'you', text: 'Review Atlas.' },
      { who: 'sky', text: 'I checked the' },
    ])
    lifetime.abort()
    await lease.close()
    const transcript = {
      after: 0,
      turns: [
        { who: 'you', text: 'Review Atlas.' },
        { who: 'sky', text: 'I checked the Atlas document.' },
        { who: 'you', text: 'Keep the draft.' },
        { who: 'sky', text: 'The draft is kept.' },
      ],
      ...prefs,
    }
    const saved = await post(chat, '/atlas/voice', transcript)
    const repeated = await post(chat, '/atlas/voice', transcript)
    await (await post(chat, '/atlas/messages', { message: 'What comes next?', ...prefs })).text()
    const stale = await post(chat, '/atlas/voice', transcript)
    const recovery = await readSession(fixture.snapshotPath('atlas'), { baseDir: root, snapshot: true })
    assert({
      given: 'late captions, an identical handoff retry, then a newer text reply',
      should: 'replace only the provisional voice segment and refuse to overwrite newer conversation',
      actual: [
        saved.status,
        repeated.status,
        stale.status,
        recovery.state.conversation.map(({ content }) => content),
        fixture.calls.at(-1)?.filter((message) => message.role === 'user').length,
        fixture.calls
          .at(-1)
          ?.filter((message) => message.role === 'assistant')
          .map((message) => message.content),
      ],
      expected: [
        200,
        200,
        409,
        [
          'Review Atlas.',
          'Sky: I checked the Atlas document.',
          'Keep the draft.',
          'Sky: The draft is kept.',
          'What comes next?',
          FILE_CHAT_REPLY,
        ],
        3,
        ['Sky: I checked the Atlas document.', 'Sky: The draft is kept.'],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('voice shares chat tools, approvals, files and drafts and retains results for text continuation', async () => {
  const root = await makeTempDir({ prefix: 'sky-voice-chat-' })
  try {
    const source = path.join(root, 'Atlas.txt')
    await writeFile(source, 'Atlas source evidence. '.repeat(5000))
    const outputs: Array<{ callId: string; output: VoiceToolOutput }> = []
    const contexts: string[][] = []
    let approved = false
    let writes = 0
    let resumes = 0
    let closed = 0
    const fixture = fileChatHost(root, [], async (hooks) => {
      contexts.push(hooks.context.conversation.map((turn) => turn.content))
      return {
        tools: {
          ...createChatFileTools({
            today: new PlainDate('2026-01-27'),
            attachmentsRoot: path.join(root, 'attachments'),
            cwd: root,
            onAttachments: hooks.onAttachments,
          }),
          keep_draft: tool({
            inputSchema: z.object({ text: z.string() }),
            execute: async ({ text }) => {
              writes++
              await hooks.writingDrafts!.link('2026-01-27_093000_Atlas-Draft')
              hooks.onExternalFiles([{ title: 'Atlas draft', url: 'https://example.com/atlas' }])
              hooks.onCreatedDocuments([path.join(root, 'time/2026/W05/01-27/Atlas.md')])
              hooks.onImages([{ name: 'Atlas diagram', url: '/chat/files/2026-01-27/Atlas.png' }])
              return { success: true, text }
            },
          }),
        },
        toolApproval: { keep_draft: () => (approved ? 'approved' : 'user-approval') },
        prepareApproval: async () => ({
          summary: 'Keep the Atlas draft.',
          approve: async () => {
            approved = true
          },
        }),
      }
    })
    const chat = createChatRoutes(fixture.host)
    const voice = createVoiceRoutes({
      openChat: chat.openVoice,
      createThread: async (_id, signal, access) => {
        const initial = await voiceChatTools(access!, [], signal!)
        return {
          session: voiceSessionConfig({
            voice: 'marin',
            instructions: 'Listen.',
            backendInstructions: initial.instructions,
            tools: [...initial.tools.values()].map((entry) => entry.definition).concat(APPROVAL_TOOLS),
          }),
          greeting: 'Hello.',
          tools: initial.tools,
          toolsFor: async (_delegationId, turns) => (await voiceChatTools(access!, turns, signal!)).tools,
        }
      },
      connect: async () => ({
        sessionId: 'live_synthetic',
        sdp: 'v=0\r\nanswer',
        backend: {
          output: async (callId, output) => {
            outputs.push({ callId, output })
          },
          resume: async () => {
            resumes++
          },
          close: () => {
            closed++
          },
        },
      }),
    })
    const app = new Hono().route('/chat', chat).route('/voice', voice)
    const connected = await post(app, '/voice/call/session', {
      sdp: 'v=0\r\noffer',
      chat: { id: 'atlas', after: 0, ...prefs },
    })
    const connection = (await connected.json()) as { tools: string[]; model: string; serverTools: boolean }
    const competing = await post(app, '/chat/atlas/messages', { message: 'Competing text turn', ...prefs })
    assert({
      given: 'a call attached to a new chat',
      should: 'expose the full shared registry and reserve that conversation',
      actual: [
        connected.status,
        connection.model,
        connection.serverTools,
        connection.tools.includes('move_path'),
        connection.tools.includes('keep_draft'),
        competing.status,
        fixture.calls.length,
      ],
      expected: [200, 'gpt-live-1', true, true, true, 409, 0],
    })
    const call = (name: string, input: object, callId: string, delegationId = 'request') =>
      post(app, '/voice/call/tools', {
        name,
        arguments: JSON.stringify(input),
        callId,
        delegationId,
        turns: spoken,
      })
    await call('read_file', { path: source }, 'read')
    await call('keep_draft', { text: 'Atlas is ready for review.' }, 'draft')
    const parked = JSON.parse(outputs.find((entry) => entry.callId === 'draft')!.output as string) as {
      approvalId: string
    }
    assert({
      given: 'a document read and an unapproved write',
      should: 'send actual large document content and hold the write',
      actual: [
        JSON.stringify(outputs[0].output).includes('Atlas source evidence.'),
        JSON.stringify(outputs[0].output).length > 65_536,
        writes,
        contexts.at(-1)?.includes(spoken[0].text),
      ],
      expected: [true, true, 0, true],
    })
    await Promise.all([
      call('confirm_action', parked, 'confirm', 'yes'),
      call('confirm_action', parked, 'confirm', 'yes'),
    ])
    await call('keep_draft', { text: 'Atlas revised.' }, 'revision', 'revise')
    await post(app, '/voice/call/continue', { callIds: ['revision'], outputs: [] })
    assert({
      given: 'confirmation retried in parallel, then a previously approved action',
      should: 'execute the first write once and reuse the shared grant',
      actual: [writes, outputs.filter((entry) => entry.callId === 'confirm').length, resumes],
      expected: [2, 1, 1],
    })
    await post(app, '/voice/call/end')
    const transcript = { after: 0, turns: [...spoken, { who: 'sky', text: 'I kept the Atlas draft.' }], ...prefs }
    const saved = await post(app, '/chat/atlas/voice', transcript)
    const repeated = await post(app, '/chat/atlas/voice', transcript)
    const recovery = await readSession(fixture.snapshotPath('atlas'), { baseDir: root, snapshot: true })
    const continued = await post(app, '/chat/atlas/messages', { message: 'What did the document say?', ...prefs })
    await continued.text()
    const modelHistory = JSON.stringify(fixture.calls.at(-1))
    assert({
      given: 'returning to text and retrying transcript delivery',
      should: 'keep artifacts, images, drafts and tool results on the same chat exactly once',
      actual: [
        saved.status,
        repeated.status,
        closed,
        recovery.attachments?.length,
        recovery.state.writingDrafts?.map((draft) => draft.id),
        recovery.state.conversation.length,
        recovery.state.conversation[1]?.content.includes('Atlas.png'),
        recovery.rel?.some((entry) => entry.includes('https://example.com/atlas')),
        modelHistory.includes('Atlas revised.'),
        fixture.calls.at(-1)?.filter((message) => message.role === 'user').length,
      ],
      expected: [200, 200, 1, 1, ['2026-01-27_093000_Atlas-Draft'], 2, true, true, true, 2],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
