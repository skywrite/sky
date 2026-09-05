import type { RealtimeFunctionTool, RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { VoiceRoutesOptions, VoiceThread } from './mod.ts'

// The routes are what is under test: the thread factory and the secret
// minter are scripted, and the tools are stubs that report their input.

const ECHO: RealtimeFunctionTool = { type: 'function', name: 'echo', parameters: { type: 'object' } }
const BOOM: RealtimeFunctionTool = { type: 'function', name: 'boom', parameters: { type: 'object' } }

const SESSION: RealtimeSessionCreateRequest = {
  type: 'realtime',
  model: 'gpt-realtime-2.1',
  audio: { output: { voice: 'marin' } },
  tools: [ECHO, BOOM],
}

const AUDITION: RealtimeSessionCreateRequest = {
  type: 'realtime',
  model: 'gpt-realtime-2.1',
  audio: { output: { voice: 'ash' } },
}

function hostWith(
  mint: VoiceRoutesOptions['mint'] = () => Promise.resolve({ value: 'ek_test', expiresAt: 1700000060 }),
) {
  const created: string[] = []
  const minted: RealtimeSessionCreateRequest[] = []
  const prepared: Array<[string, string]> = []
  const thread: VoiceThread = {
    session: SESSION,
    opening: 'Say hello.',
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
    mint: (session) => {
      minted.push(session)
      return mint(session)
    },
    audition: {
      describe: () =>
        Promise.resolve({
          passage: 'Hey Jane, ready when you are.',
          groups: { male: ['ash'], female: ['sage'] },
          current: 'ash',
          model: 'gpt-realtime-2.1',
        }),
      prepare: (voice, passage) => {
        prepared.push([voice, passage])
        if (voice !== 'ash' && voice !== 'sage') return Promise.resolve(null)
        return Promise.resolve({ session: AUDITION, opening: `Say: ${passage}` })
      },
    },
  }
  return { host, created, minted, prepared }
}

async function appWith(host: VoiceRoutesOptions) {
  const tmp = await makeTempDir({ prefix: 'sky-voice-route-' })
  return createTestHttpApp([tmp], { voice: host })
}

type App = Awaited<ReturnType<typeof appWith>>

function post(app: App, url: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

test({ name: 'voice route - a session mints a secret around the thread configuration' }, async () => {
  const { host, created, minted } = hostWith()
  const app = await appWith(host)

  const response = await post(app, '/voice/t1/session')
  assert({
    given: 'a first session request',
    should: 'answer with the secret and what the browser needs to open',
    actual: [response.status, await response.json()],
    expected: [
      200,
      {
        clientSecret: 'ek_test',
        expiresAt: 1700000060,
        model: 'gpt-realtime-2.1',
        voice: 'marin',
        opening: 'Say hello.',
        tools: ['echo', 'boom'],
      },
    ],
  })
  assert({
    given: 'the mint',
    should: 'receive the thread session configuration as is',
    actual: minted[0] === SESSION,
    expected: true,
  })

  await post(app, '/voice/t1/session')
  assert({
    given: 'a second session request on the same thread',
    should: 'mint again without building a second thread',
    actual: [created, minted.length],
    expected: [['t1'], 2],
  })
})

test({ name: 'voice route - a mint failure is reported, not thrown' }, async () => {
  const { host } = hostWith(() => Promise.reject(new Error('OPENAI_API_KEY is not set')))
  const app = await appWith(host)
  const response = await post(app, '/voice/t1/session')
  assert({
    given: 'a minter that fails',
    should: 'answer 502 with its message',
    actual: [response.status, await response.json()],
    expected: [502, { message: 'OPENAI_API_KEY is not set' }],
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

test({ name: 'voice route - the audition describes itself and mints a speaking-only session per voice' }, async () => {
  const { host, minted, prepared } = hostWith()
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
        model: 'gpt-realtime-2.1',
      },
    ],
  })

  const own = await post(app, '/voice/_api/audition/session', { voice: 'sage', passage: '  Hello there.  ' })
  assert({
    given: 'a voice and a passage',
    should: 'prepare that voice with the trimmed passage and mint its session',
    actual: [own.status, await own.json(), prepared.at(-1), minted.at(-1) === AUDITION],
    expected: [
      200,
      { clientSecret: 'ek_test', expiresAt: 1700000060, voice: 'sage', opening: 'Say: Hello there.' },
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
  assert({ given: 'a thread called audition', should: 'mint a thread session', actual: thread.status, expected: 200 })
})

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
