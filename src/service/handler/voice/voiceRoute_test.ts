import { afterEach } from 'bun:test'
import type { FunctionTool, MediaSessionConfig } from 'openai/resources/live/live'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { holding, touch } from '../../activity.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { VoiceRoutesOptions, VoiceThread } from './mod.ts'

// The routes are what is under test: the thread factory and the SDP
// connector are scripted, and the tools are stubs that report their input.

const ECHO: FunctionTool = { type: 'function', name: 'echo', parameters: { type: 'object' } }
const BOOM: FunctionTool = { type: 'function', name: 'boom', parameters: { type: 'object' } }

const SESSION: MediaSessionConfig = {
  model: 'gpt-live-1',
  instructions: 'You are Sky. Speak naturally.',
  audio: { output: { voice: 'marin' } },
  delegation: { type: 'responses', responses: { model: 'gpt-6.1-sol', tools: [ECHO, BOOM] } },
}

const AUDITION: MediaSessionConfig = {
  model: 'gpt-live-1',
  audio: { output: { voice: 'ash' } },
}

function hostWith(
  connect: VoiceRoutesOptions['connect'] = () => Promise.resolve({ sessionId: 'live_test', sdp: 'test-answer' }),
) {
  const created: string[] = []
  const connected: MediaSessionConfig[] = []
  const prepared: Array<[string, string]> = []
  const thread: VoiceThread = {
    session: SESSION,
    greeting: 'Hey.',
    tools: new Map([
      [
        'echo',
        { definition: ECHO, run: (input: Record<string, unknown>) => Promise.resolve(`echo:${JSON.stringify(input)}`) },
      ],
      ['boom', { definition: BOOM, run: () => Promise.reject(new Error('kaboom')) }],
    ]),
  }
  const host: VoiceRoutesOptions = {
    createThread: (id) => {
      created.push(id)
      return Promise.resolve(thread)
    },
    connect: (session, sdp, signal) => {
      connected.push(session)
      return connect(session, sdp, signal)
    },
    audition: {
      describe: () =>
        Promise.resolve({
          passage: 'Hey Jane, ready when you are.',
          groups: { male: ['ash'], female: ['sage'] },
          current: 'ash',
          model: 'gpt-live-1',
        }),
      prepare: (voice, passage) => {
        prepared.push([voice, passage])
        if (voice !== 'ash' && voice !== 'sage') return Promise.resolve(null)
        return Promise.resolve({ session: AUDITION, opening: `Say: ${passage}` })
      },
    },
  }
  return { host, created, connected, prepared }
}

async function appWith(host: VoiceRoutesOptions) {
  const tmp = await makeTempDir({ prefix: 'sky-voice-route-' })
  return createTestHttpApp([tmp], { voice: host })
}

type App = Awaited<ReturnType<typeof appWith>>

const calls = new Map<App, Set<string>>()

afterEach(async () => {
  // Calls outlive their requests; end them even when a test assertion fails.
  const opened = [...calls]
  calls.clear()
  for (const [app, ids] of opened) {
    for (const id of ids) await post(app, `/voice/${id}/end`)
  }
})

function post(app: App, url: string, body?: unknown): Promise<Response> {
  if (url.endsWith('/session')) body = { sdp: 'v=0\r\nmock-offer', ...(body as Record<string, unknown>) }
  const call = /^\/voice\/([^/]+)\/(?:session|tools)$/.exec(url)
  if (call) {
    if (!calls.has(app)) calls.set(app, new Set())
    calls.get(app)!.add(call[1])
  }
  return Promise.resolve(
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

test({ name: 'voice route - a session connects an SDP answer for the trusted thread configuration' }, async () => {
  const { host, created, connected } = hostWith()
  const app = await appWith(host)

  const response = await post(app, '/voice/t1/session')
  assert({
    given: 'a first session request',
    should: 'answer with the SDP and what the browser needs to open',
    actual: [response.status, await response.json()],
    expected: [
      200,
      {
        sessionId: 'live_test',
        sdp: 'test-answer',
        model: 'gpt-live-1',
        voice: 'marin',
        opening: 'The audio is ready. Immediately greet the user by saying exactly \"Hey.\", then pause and listen.',
        tools: ['echo', 'boom'],
        serverTools: false,
      },
    ],
  })
  assert({
    given: 'the connect',
    should: 'receive the thread session configuration as is',
    actual: connected[0] === SESSION,
    expected: true,
  })

  await post(app, '/voice/t1/session')
  assert({
    given: 'a second session request on the same thread',
    should: 'connect again without building a second thread',
    actual: [created, connected.length],
    expected: [['t1'], 2],
  })
})

test({ name: 'voice route - a connect failure is reported, not thrown' }, async () => {
  const { host } = hostWith(() => Promise.reject(new Error('OPENAI_API_KEY is not set')))
  const app = await appWith(host)
  const response = await post(app, '/voice/t1/session')
  assert({
    given: 'a connector that fails',
    should: 'answer 502 with its message',
    actual: [response.status, await response.json()],
    expected: [502, { message: 'OPENAI_API_KEY is not set' }],
  })
})

test('voice route - startup history fits Live even when characters need several UTF-8 bytes', async () => {
  const { host, connected, created } = hostWith()
  const app = await appWith(host)
  const response = await post(app, '/voice/history/session', {
    context: 'Earlier context.\n' + '語🙂'.repeat(8000) + '\nUser: Continue Atlas.',
  })
  const part = connected[0].input?.[0].content[0]
  const text = part && 'text' in part ? part.text : ''
  assert({
    given: 'a long Unicode chat switches to voice',
    should: 'keep the recent history within the startup limit without splitting a character',
    actual: [
      response.status,
      new TextEncoder().encode(text).length < 8192,
      text.endsWith('User: Continue Atlas.'),
      text.includes('�'),
      text.includes('[Earlier chat omitted'),
    ],
    expected: [200, true, true, false, true],
  })
  const malformed = await post(app, '/voice/invalid/session', { sdp: 'invalid' })
  const oversized = await post(app, '/voice/oversized/session', { context: 'x'.repeat(60_201) })
  assert({
    given: 'invalid SDP or an oversized request',
    should: 'reject it before building a thread or contacting OpenAI',
    actual: [malformed.status, oversized.status, created, connected.length],
    expected: [400, 400, ['history'], 1],
  })
})

test('voice route - ending a call aborts research and rejects late tool calls', async () => {
  const { host } = hostWith()
  const create = host.createThread
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  let aborted = false
  host.createThread = async (id) => {
    const thread = await create(id)
    thread.tools.set('research_notebook', {
      definition: { ...ECHO, name: 'research_notebook' },
      run: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('Research cancelled.'))
            },
            { once: true },
          )
          markStarted()
        }),
    })
    return thread
  }
  const app = await appWith(host)
  const running = post(app, '/voice/duet/tools', { name: 'research_notebook', arguments: '{}' })
  await started
  touch('voice:duet', 'voice', 0)
  assert({
    given: 'research outlasting the browser conversation hold',
    should: 'keep a service reload waiting until the tool settles',
    actual: holding().includes('voice tool: research_notebook'),
    expected: true,
  })
  const end = await post(app, '/voice/duet/end')
  const result = await running
  assert({
    given: 'the research cancelled by ending the call',
    should: 'release its independent service hold',
    actual: holding().includes('voice tool: research_notebook'),
    expected: false,
  })
  const late = await post(app, '/voice/duet/tools', { name: 'echo', arguments: '{}' })
  assert({
    given: 'research still running when the call ends',
    should: 'abort the model/tool chain and prevent late callbacks from reopening the thread',
    actual: [end.status, aborted, (await result.json()).output, late.status],
    expected: [200, true, 'Tool failed: Research cancelled.', 410],
  })
  assert({
    given: 'the user explicitly starts another call on the same page',
    should: 'allow a new session after the previous call ended',
    actual: (await post(app, '/voice/duet-next/session')).status,
    expected: 200,
  })
})

test('voice route - end during startup prevents a late session from becoming live', async () => {
  const { host } = hostWith()
  const create = host.createThread
  let finish = () => {}
  const release = new Promise<void>((resolve) => {
    finish = resolve
  })
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  host.createThread = async (id) => {
    markStarted()
    await release
    return create(id)
  }
  const app = await appWith(host)
  const connecting = post(app, '/voice/duet/session')
  await started
  await post(app, '/voice/duet/end')
  finish()
  const late = await connecting
  assert({
    given: 'a cancelled call whose initial context finishes loading afterward',
    should: 'return an ended session instead of connecting a call',
    actual: late.status,
    expected: 410,
  })
})

test({ name: 'voice route - tool calls run on the thread and answer as the model reads them' }, async () => {
  const { host, created } = hostWith()
  const app = await appWith(host)

  // The call lives in the browser; a thread the service has lost (a restart
  // mid-conversation) is rebuilt by the next tool call, not refused.
  const ran = await post(app, '/voice/t1/tools', { name: 'echo', arguments: '{"question":"what now"}' })
  assert({
    given: 'a call on a thread the service has not seen',
    should: 'build the thread on demand',
    actual: created,
    expected: ['t1'],
  })
  assert({
    given: 'a call with JSON arguments',
    should: 'run the tool with them parsed and return its output',
    actual: [ran.status, await ran.json()],
    expected: [200, { output: 'echo:{"question":"what now"}' }],
  })

  const malformed = await post(app, '/voice/t1/tools', { name: 'echo', arguments: '{not json' })
  assert({
    given: 'arguments the model mangled',
    should: 'run the tool with none',
    actual: await malformed.json(),
    expected: { output: 'echo:{}' },
  })

  const unknown = await post(app, '/voice/t1/tools', { name: 'nope', arguments: '{}' })
  assert({
    given: 'a tool the thread does not have',
    should: 'tell the model so, as output',
    actual: [unknown.status, await unknown.json()],
    expected: [200, { output: 'Unknown tool: nope' }],
  })

  const failed = await post(app, '/voice/t1/tools', { name: 'boom', arguments: '{}' })
  assert({
    given: 'a tool that throws',
    should: 'cross the boundary as a failure string',
    actual: [failed.status, await failed.json()],
    expected: [200, { output: 'Tool failed: kaboom' }],
  })

  const nameless = await post(app, '/voice/t1/tools', { arguments: '{}' })
  assert({ given: 'a call without a name', should: 'be 400', actual: nameless.status, expected: 400 })
})

test('voice route - ending during tool-triggered thread reconstruction returns an ended response', async () => {
  const { host } = hostWith()
  const create = host.createThread
  let finish = () => {}
  let markStarted = () => {}
  const release = new Promise<void>((resolve) => {
    finish = resolve
  })
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  host.createThread = async (id) => {
    markStarted()
    await release
    return create(id)
  }
  const app = await appWith(host)
  const reconstructing = post(app, '/voice/rebuild/tools', { name: 'echo', arguments: '{}' })
  await started
  await post(app, '/voice/rebuild/end')
  finish()
  const response = await reconstructing
  assert({
    given: 'a tool rebuilding a lost thread when the user ends the call',
    should: 'return a controlled ended response instead of an uncaught construction error',
    actual: [response.status, await response.json()],
    expected: [410, { output: 'This voice session has ended.' }],
  })
})

test(
  { name: 'voice route - the audition describes itself and connects a speaking-only session per voice' },
  async () => {
    const { host, connected, prepared } = hostWith()
    const app = await appWith(host)

    const info = await app.request('/voice/_api/audition')
    assert({
      given: 'the audition',
      should: 'give the page its passage, groups, and current voice',
      actual: [info.status, await info.json()],
      expected: [
        200,
        {
          passage: 'Hey Jane, ready when you are.',
          groups: { male: ['ash'], female: ['sage'] },
          current: 'ash',
          model: 'gpt-live-1',
        },
      ],
    })

    const own = await post(app, '/voice/_api/audition/session', { voice: 'sage', passage: '  Hello there.  ' })
    assert({
      given: 'a voice and a passage',
      should: 'prepare that voice with the trimmed passage and connect its session',
      actual: [own.status, await own.json(), prepared.at(-1), connected.at(-1) === AUDITION],
      expected: [
        200,
        { sessionId: 'live_test', sdp: 'test-answer', voice: 'sage', opening: 'Say: Hello there.' },
        ['sage', 'Hello there.'],
        true,
      ],
    })

    await post(app, '/voice/_api/audition/session', { voice: 'ash', passage: '   ' })
    assert({
      given: 'a blank passage',
      should: 'fall back to the default one',
      actual: prepared.at(-1),
      expected: ['ash', 'Hey Jane, ready when you are.'],
    })

    const unknown = await post(app, '/voice/_api/audition/session', { voice: 'nope' })
    const nameless = await post(app, '/voice/_api/audition/session', {})
    assert({
      given: 'a voice that does not exist, or none',
      should: 'be 400 either way',
      actual: [unknown.status, nameless.status],
      expected: [400, 400],
    })

    // A thread named "audition" is still a thread: _api keeps the two apart.
    const thread = await post(app, '/voice/audition/session')
    assert({
      given: 'a thread called audition',
      should: 'connect a thread session',
      actual: thread.status,
      expected: 200,
    })
  },
)

test({ name: 'voice route - without an audition host the audition is not served' }, async () => {
  const { host } = hostWith()
  const app = await appWith({ ...host, audition: undefined })
  const info = await app.request('/voice/_api/audition')
  const own = await post(app, '/voice/_api/audition/session', { voice: 'ash' })
  assert({
    given: 'no audition host',
    should: 'answer 404 to both routes',
    actual: [info.status, own.status],
    expected: [404, 404],
  })
})

test({ name: 'voice route - ending a thread forgets it' }, async () => {
  const { host } = hostWith()
  const app = await appWith(host)
  await post(app, '/voice/t1/session')

  const ended = await post(app, '/voice/t1/end')
  assert({
    given: 'an end',
    should: 'confirm it',
    actual: [ended.status, await ended.json()],
    expected: [200, { ended: true }],
  })

  const again = await post(app, '/voice/t1/end')
  assert({
    given: 'the thread is gone',
    should: 'answer 404 to a second end',
    actual: again.status,
    expected: 404,
  })
})

test({ name: 'voice route - a gated tool parks until confirm_action, and only once' }, async () => {
  const { host } = hostWith()
  const runs: Record<string, unknown>[] = []
  const thread = await host.createThread('t')
  thread.tools.set('draft', {
    definition: { type: 'function', name: 'draft', parameters: { type: 'object' } },
    run: (input) => {
      runs.push(input)
      return Promise.resolve('draft saved')
    },
    needsApproval: true,
  })
  const app = await appWith(host)

  const parked = await post(app, '/voice/gate/tools', { name: 'draft', arguments: '{"text":"hey"}' })
  const parkedBody = (await parked.json()) as { output: string }
  const payload = JSON.parse(parkedBody.output) as { needsConfirmation: boolean; approvalId: string; summary: string }
  assert({
    given: 'a call to a tool that needs approval',
    should: 'park it and run nothing',
    actual: [payload.needsConfirmation, runs.length, payload.summary.includes('hey')],
    expected: [true, 0, true],
  })

  const confirmed = await post(app, '/voice/gate/tools', {
    name: 'confirm_action',
    arguments: JSON.stringify({ approvalId: payload.approvalId }),
  })
  assert({
    given: 'the spoken yes relayed as confirm_action',
    should: 'execute the parked call with its original input',
    actual: [((await confirmed.json()) as { output: string }).output, runs],
    expected: ['draft saved', [{ text: 'hey' }]],
  })

  const again = await post(app, '/voice/gate/tools', {
    name: 'confirm_action',
    arguments: JSON.stringify({ approvalId: payload.approvalId }),
  })
  assert({
    given: 'the same approvalId a second time',
    should: 'refuse — an approval is single-use',
    actual: ((await again.json()) as { output: string }).output.startsWith('No such pending action'),
    expected: true,
  })
})

test({ name: 'voice route - cancel_action discards a parked call' }, async () => {
  const { host } = hostWith()
  const runs: unknown[] = []
  const thread = await host.createThread('t')
  thread.tools.set('draft', {
    definition: { type: 'function', name: 'draft', parameters: { type: 'object' } },
    run: (input) => {
      runs.push(input)
      return Promise.resolve('draft saved')
    },
    needsApproval: true,
  })
  const app = await appWith(host)

  const parked = await post(app, '/voice/gate2/tools', { name: 'draft', arguments: '{"text":"scrap it"}' })
  const payload = JSON.parse(((await parked.json()) as { output: string }).output) as { approvalId: string }

  const cancelled = await post(app, '/voice/gate2/tools', {
    name: 'cancel_action',
    arguments: JSON.stringify({ approvalId: payload.approvalId }),
  })
  const line = ((await cancelled.json()) as { output: string }).output
  assert({
    given: 'a decline relayed as cancel_action',
    should: 'discard the call without running it',
    actual: [line.startsWith('Cancelled — nothing was done.'), runs.length],
    expected: [true, 0],
  })

  const retry = await post(app, '/voice/gate2/tools', {
    name: 'confirm_action',
    arguments: JSON.stringify({ approvalId: payload.approvalId }),
  })
  assert({
    given: 'a confirm after the cancel',
    should: 'find nothing pending',
    actual: ((await retry.json()) as { output: string }).output.startsWith('No such pending action'),
    expected: true,
  })
})

test({ name: 'voice route - an ungated tool still runs straight through' }, async () => {
  const { host } = hostWith()
  const app = await appWith(host)
  const response = await post(app, '/voice/gate3/tools', { name: 'echo', arguments: '{"a":1}' })
  assert({
    given: 'a tool without the approval flag',
    should: 'run immediately as before',
    actual: ((await response.json()) as { output: string }).output,
    expected: 'echo:{"a":1}',
  })
})
