import { afterEach } from 'bun:test'
import { Hono } from 'hono'
import type { FunctionTool, MediaSessionConfig } from 'openai/resources/live/live'
import { assert, test } from '#test'
import type { VoiceNote } from './liveBackend.ts'
import { createVoiceRoutes, researchFindings, type VoiceThread, type VoiceToolOutput } from './mod.ts'

// The service's own notes to a running call: research that runs past its delegation, and the
// speaking model's page kept current. The routes are under test; the host and session are scripted.

const RESEARCH: FunctionTool = { type: 'function', name: 'ai_research', parameters: { type: 'object' } }
const ADD: FunctionTool = { type: 'function', name: 'day_items_add', parameters: { type: 'object' } }

const SESSION: MediaSessionConfig = {
  model: 'gpt-live-1.1',
  delegation: { type: 'responses', responses: { model: 'gpt-6.1-sol', tools: [RESEARCH, ADD] } },
}

/** Every call a test opens is ended afterwards, so its activity hold never reaches a later test. */
const open = new Set<(path: string, body: unknown) => Response | Promise<Response>>()

afterEach(async () => {
  for (const post of open) await post('/voice/call/end', {})
  open.clear()
})

/**
 * A call whose research finishes or fails only when the test says so. Like ai:research it stops when
 * aborted, unless `ignoreAbort`; `failNotes` makes that many note deliveries fail first.
 */
function scripted({ failNotes = 0, ignoreAbort = false } = {}) {
  const notes: VoiceNote[] = []
  const outputs = new Map<string, VoiceToolOutput>()
  let settleResearch!: (output: VoiceToolOutput) => void
  let researchSignal: AbortSignal | undefined
  let researchRuns = 0
  let failing = failNotes
  let lists = 'To-dos: Buy milk.'
  let told = lists
  const thread: VoiceThread = {
    session: SESSION,
    greeting: 'Hey.',
    tools: new Map([
      [
        'ai_research',
        {
          definition: RESEARCH,
          background: true,
          run: (input: Record<string, unknown>, signal?: AbortSignal) => {
            researchRuns++
            researchSignal = signal
            if (typeof input.question !== 'string')
              return Promise.reject(new Error('Required parameter "question" is missing'))
            return new Promise<VoiceToolOutput>((resolve) => {
              settleResearch = resolve
              if (!ignoreAbort)
                signal?.addEventListener('abort', () =>
                  resolve(JSON.stringify({ success: false, status: 'failed', error: 'Research stopped.' })),
                )
            })
          },
        },
      ],
      [
        'day_items_add',
        {
          definition: ADD,
          run: async () => {
            lists = 'To-dos: Buy milk; Call Jane Doe.'
            return '{"success":true}'
          },
        },
      ],
    ]),
    refresh: async (_cause, deliver) => {
      if (lists === told) return
      await deliver([`Update at 3:41 PM. This replaces "Today's lists"; no reply needed.\n${lists}`])
      told = lists
    },
  }
  const voice = createVoiceRoutes({
    createThread: async () => thread,
    connect: async () => ({
      sessionId: 'live_test',
      sdp: 'answer',
      backend: {
        output: async (callId, output) => {
          if (!outputs.has(callId)) outputs.set(callId, output)
        },
        resume: async () => {},
        note: async (note) => {
          if (failing > 0) {
            failing--
            throw new Error('The voice tool connection closed.')
          }
          notes.push(note)
        },
        close: () => {},
      },
    }),
  })
  const app = new Hono().route('/voice', voice)
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  open.add(post)
  const ask = (callId: string, args: Record<string, unknown>) =>
    post('/voice/call/tools', { name: 'ai_research', arguments: JSON.stringify(args), callId, delegationId: callId })
  return {
    post,
    ask,
    notes,
    outputs,
    finish: (digest: string) =>
      settleResearch(JSON.stringify({ success: true, data: { digest, sources: ['notes/atlas.md'] } })),
    fail: (error: string) => settleResearch(JSON.stringify({ success: false, status: 'failed', error })),
    researchSignal: () => researchSignal,
    researchRuns: () => researchRuns,
  }
}

const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))
const status = (output: VoiceToolOutput | undefined) => (JSON.parse(output as string) as { status: string }).status
const summary = (notes: VoiceNote[]) =>
  notes.map((note) =>
    note.type === 'response.item.create'
      ? `${note.type}: ${((note.item as { content: Array<{ text: string }> }).content[0]?.text ?? '').slice(0, 40)}`
      : `${note.type}: ${note.content.slice(0, 40)}`,
  )

test('research runs past its delegation: the turn answers within a second, and the findings arrive as notes', async () => {
  const call = scripted()
  await call.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  const asked = await call.ask('research-1', { question: 'What did Jane Doe decide about Atlas?' })
  const repeated = await call.ask('research-2', { question: 'what did jane doe decide about atlas?' })
  const notesBeforeFinish = call.notes.length
  call.finish('Jane Doe decided to ship Atlas on Friday.\n\nThe review moved to Monday.')
  await settle()
  const commentary = call.notes.find((note) => note.type === 'session.commentary.append')
  assert({
    given: 'a research request, the same question again while it runs, then the research finishing',
    should:
      'answer both turns without a second run, then queue the evidence and say the lead, findings before the question',
    actual: {
      statuses: [asked.status, repeated.status],
      placeholder: status(call.outputs.get('research-1')),
      again: status(call.outputs.get('research-2')),
      runs: call.researchRuns(),
      notesBeforeFinish,
      notes: summary(call.notes),
      findingsFirst:
        commentary?.type === 'session.commentary.append' &&
        commentary.content.indexOf('Findings: Jane Doe decided to ship Atlas on Friday.') <
          commentary.content.indexOf('Asked: "What did Jane Doe decide about Atlas?"'),
      leadOnly: commentary?.type === 'session.commentary.append' && commentary.content.includes('Monday'),
    },
    expected: {
      statuses: [200, 200],
      placeholder: 'running in the background',
      again: 'already running',
      runs: 1,
      notesBeforeFinish: 0,
      notes: [
        'response.item.create: Background research finished for "What d',
        'session.commentary.append: The research the user asked for has fini',
      ],
      findingsFirst: true,
      leadOnly: false,
    },
  })
})

test('a research call that fails at once answers its turn like any tool, so the backend can correct it', async () => {
  const call = scripted()
  await call.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  const started = performance.now()
  await call.ask('research-1', { query: 'Atlas status' })
  const ms = performance.now() - started
  assert({
    given: 'research called with the wrong argument name',
    should: 'return the failure as the tool output, quickly, with no placeholder and nothing said',
    actual: { output: call.outputs.get('research-1'), quick: ms < 900, notes: call.notes.length },
    expected: {
      output: 'Tool failed: Required parameter "question" is missing',
      quick: true,
      notes: 0,
    },
  })
})

test('research that fails later tells the backend it stopped, then the user', async () => {
  const call = scripted()
  await call.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  await call.ask('research-1', { question: 'Atlas status' })
  call.fail('Notebook research is turned off.')
  await settle()
  assert({
    given: 'a running research that then fails with a chat tool failure',
    should: 'send the backend the reason and that it is no longer running, then give the speaking model the reason',
    actual: call.notes.map((note) => (note.type === 'response.item.create' ? JSON.stringify(note.item) : note.content)),
    expected: [
      JSON.stringify({
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'Background research for "Atlas status" failed and is no longer running: Notebook research is turned off. Start it again only if the user asks.',
          },
        ],
      }),
      'The research the user asked for could not finish. Tell them briefly at the next natural pause and offer to try again. Reason: Notebook research is turned off. Asked: "Atlas status".',
    ],
  })
})

test('ending the call stops a background run, waits only for it to unwind, and says nothing afterwards', async () => {
  const stops = scripted()
  await stops.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  await stops.ask('research-1', { question: 'Atlas status' })
  let started = performance.now()
  const ended = await stops.post('/voice/call/end', {})
  const stopsMs = performance.now() - started
  const ignores = scripted({ ignoreAbort: true })
  await ignores.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  await ignores.ask('research-1', { question: 'Atlas status' })
  started = performance.now()
  await ignores.post('/voice/call/end', {})
  const ignoresMs = performance.now() - started
  ignores.finish('Too late.')
  await settle()
  assert({
    given: 'a call ended while its research runs, and another whose research ignores the abort',
    should: 'abort both, end the first as soon as it stops, the second after a bounded wait, and say nothing',
    actual: {
      status: ended.status,
      aborted: [stops.researchSignal()?.aborted, ignores.researchSignal()?.aborted],
      stopsQuickly: stopsMs < 300,
      boundedWait: ignoresMs >= 1400 && ignoresMs < 2500,
      notes: stops.notes.length + ignores.notes.length,
    },
    expected: { status: 200, aborted: [true, true], stopsQuickly: true, boundedWait: true, notes: 0 },
  })
})

test('a change to the day reaches the speaking model as a silent note, and one that fails to send goes again', async () => {
  const call = scripted({ failNotes: 1 })
  await call.post('/voice/call/session', { sdp: 'v=0\r\noffer' })
  await call.post('/voice/call/tools', {
    name: 'day_items_add',
    arguments: JSON.stringify({ list: 'todos', text: 'Call Jane Doe' }),
    callId: 'add-1',
    delegationId: 'd1',
  })
  await settle()
  const afterFailure = call.notes.length
  await call.post('/voice/call/keepalive', {})
  await settle()
  await call.post('/voice/call/keepalive', {})
  await settle()
  assert({
    given: 'an item added by a tool whose note fails to send, then two heartbeats',
    should: 'send the note on the next heartbeat, once, and nothing on the quiet one after',
    actual: { afterFailure, notes: call.notes },
    expected: {
      afterFailure: 0,
      notes: [
        {
          type: 'session.thinking.append',
          content:
            'Update at 3:41 PM. This replaces "Today\'s lists"; no reply needed.\nTo-dos: Buy milk; Call Jane Doe.',
        },
      ],
    },
  })
})

test('research findings: the lead paragraph to say, the digest to keep, and failures said plainly', () => {
  assert({
    given: 'a digest in the command result, a chat tool failure, an older failure shape, and a tool failure string',
    should: 'take the first paragraph as the lead and read the reason from each failure',
    actual: [
      researchFindings(JSON.stringify({ success: true, data: { digest: 'Atlas ships Friday.\n\nDetails follow.' } })),
      researchFindings(JSON.stringify({ success: false, status: 'failed', error: 'Notebook research is turned off.' })),
      researchFindings(JSON.stringify({ success: false, message: 'The notebook service is unavailable.' })),
      researchFindings('Tool failed: timed out'),
    ],
    expected: [
      { lead: 'Atlas ships Friday.', full: 'Atlas ships Friday.\n\nDetails follow.', failed: false },
      { lead: 'Notebook research is turned off.', full: 'Notebook research is turned off.', failed: true },
      { lead: 'The notebook service is unavailable.', full: 'The notebook service is unavailable.', failed: true },
      { lead: 'Tool failed: timed out', full: 'Tool failed: timed out', failed: true },
    ],
  })
})
