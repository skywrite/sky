import { assert, test } from '#test'
import { VoiceController, type VoiceEvent, type VoiceDependencies } from './voiceController.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
class Channel {
  readyState = 'connecting'
  onmessage?: (event: { data: string }) => void
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  sent: Array<Record<string, any>> = []
  send(text: string) {
    this.sent.push(JSON.parse(text))
  }
  emit(event: VoiceEvent) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }
}
class Track {
  kind = 'audio'
  enabled = true
  stopped = false
  stop() {
    this.stopped = true
  }
}
function media() {
  const track = new Track()
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream }
}
class Peer extends EventTarget {
  dc = new Channel()
  sctp = { maxMessageSize: 65_536 }
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  ontrack?: (event: { streams: MediaStream[] }) => void
  onconnectionstatechange?: () => void
  sender = {
    track: null as MediaStreamTrack | null,
    replaceTrack: async (track: MediaStreamTrack) => {
      this.sender.track = track
    },
  }
  audioLevel = 0
  createDataChannel() {
    return this.dc
  }
  addTrack(track: MediaStreamTrack) {
    this.sender.track = track
  }
  getSenders() {
    return [this.sender]
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: 'original-offer' }
  }
  async setLocalDescription() {
    this.localDescription = { type: 'offer', sdp: 'v=0\r\ngathered-offer' }
  }
  async setRemoteDescription(answer: RTCSessionDescriptionInit) {
    this.remoteDescription = answer
  }
  async getStats() {
    return new Map([['audio', { id: 'audio', type: 'inbound-rtp', kind: 'audio', audioLevel: this.audioLevel }]])
  }
  connect() {
    this.connectionState = 'connected'
    this.dc.readyState = 'open'
    this.dc.onopen?.()
    this.ontrack?.({ streams: [media().stream] })
    this.dc.emit({ type: 'session.started' })
  }
  close() {
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }
}
function harness(serverTools = false) {
  const peers: Peer[] = []
  const microphones: ReturnType<typeof media>[] = []
  const timers = new Map<number, { callback: () => void; ms: number }>()
  let nextTimer = 0
  const requests: Array<{ url: string; body: any; signal?: AbortSignal | null }> = []
  const outputs = new Map<string, Promise<string>>()
  const audio = {
    srcObject: null,
    muted: false,
    paused: true,
    volume: 1,
    sink: '',
    play: async () => {
      audio.paused = false
    },
    pause: () => {
      audio.paused = true
    },
    setSinkId: async (id: string) => {
      audio.sink = id
    },
  }
  const deps: VoiceDependencies = {
    fetch: async (url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url: String(url), body, signal: init?.signal })
      if (String(url).endsWith('/session'))
        return Response.json({
          sessionId: 'live_test',
          sdp: 'test-answer',
          model: 'gpt-live-1',
          voice: 'marin',
          opening: 'Say hello, then listen.',
          tools: ['read_file'],
          serverTools,
        })
      if (String(url).endsWith('/tools')) {
        const output = await (outputs.get(body.name) ?? Promise.resolve('verified result'))
        return Response.json(serverTools ? { submitted: true } : { output })
      }
      return Response.json({ ended: true })
    },
    createPeer: () => {
      const peer = new Peer()
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
    getUserMedia: async () => {
      const mic = media()
      microphones.push(mic)
      return mic.stream
    },
    audio: () => audio as unknown as HTMLAudioElement,
    warmSpeakers: async () => {},
    setTimer: (callback, ms) => {
      timers.set(++nextTimer, { callback, ms })
      return nextTimer
    },
    clearTimer: (id) => {
      timers.delete(id)
    },
  }
  const controller = new VoiceController('test-call', deps, () => {})
  const runTimer = async (ms: number) => {
    const pending = [...timers]
    for (const [id, timer] of pending)
      if (timer.ms === ms) {
        timers.delete(id)
        timer.callback()
      }
    await settle()
  }
  const open = async () => {
    await controller.start()
    peers.at(-1)!.connect()
    await settle()
    return peers.at(-1)!
  }
  const close = async () => {
    const ending = controller.end()
    peers.at(-1)?.dc.emit({ type: 'session.closed' })
    await ending
  }
  return { controller, peers, microphones, timers, requests, outputs, audio, deps, runTimer, open, close }
}
function backend(peer: Peer, event: NonNullable<VoiceEvent['event']>, delegationId = 'task-1') {
  peer.dc.emit({ type: 'response.event', delegation_id: delegationId, event })
}
function requestTool(peer: Peer, name: string, callId: string, responseId = 'response-1') {
  backend(peer, {
    type: 'response.output_item.done',
    response_id: responseId,
    item: { type: 'function_call', name, call_id: callId, arguments: '{"path":"notes/Atlas.md"}' },
  })
}

test('voice waits for server-owned outputs and resumes over the same server connection', async () => {
  const h = harness(true)
  const second = deferred<string>()
  h.outputs.set('read_file', second.promise)
  const chat = { id: 'atlas', after: 2, profile: 'test', effort: 'default' as const, contextTokens: 0, saves: true }
  await h.controller.start(null, null, 'Previous chat.', chat)
  const peer = h.peers[0]
  peer.connect()
  await settle()
  peer.dc.emit({
    type: 'session.input_transcript.delta',
    delta: 'Read Atlas and save a draft.',
    start_ms: 1000,
    end_ms: 2000,
  })
  backend(peer, { type: 'response.created', response: { id: 'response-1' } })
  requestTool(peer, 'keep_draft', 'draft')
  requestTool(peer, 'read_file', 'read')
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  await settle()
  assert({
    given: 'one server tool still running',
    should: 'retain the chat identity and spoken intent and wait for every output',
    actual: [
      h.requests[0].body.chat,
      h.requests.find((entry) => entry.url.endsWith('/tools'))?.body.turns[0]?.text,
      h.requests.filter((entry) => entry.url.endsWith('/continue')).length,
    ],
    expected: [chat, 'Read Atlas and save a draft.', 0],
  })
  second.resolve('large file stays on the server')
  await settle()
  assert({
    given: 'all tool outputs retained by the server',
    should: 'request one server continuation and keep tool payloads off the audio channel',
    actual: [
      h.requests.filter((entry) => entry.url.endsWith('/continue')).map((entry) => entry.body),
      peer.dc.sent.filter((event) => event.type.startsWith('response.')),
    ],
    expected: [[{ callIds: ['draft', 'read'], outputs: [] }], []],
  })
  await h.close()
})

test('voice opens one Live peer using gathered SDP and retains prior chat before greeting', async () => {
  const h = harness()
  const warm = deferred<void>()
  h.deps.warmSpeakers = () => warm.promise
  await h.controller.start('microphone-1', 'headphones', 'User: Plan Atlas.\nSky: Start with a demo.')
  const peer = h.peers[0]
  peer.connect()
  await settle()
  assert({
    given: 'a Live session whose speakers are still warming',
    should: 'create one connection and wait to greet',
    actual: [
      h.peers.length,
      h.requests[0].url,
      h.requests[0].body,
      peer.remoteDescription,
      peer.dc.sent,
      h.controller.state.phase,
    ],
    expected: [
      1,
      '/voice/test-call-1/session',
      { sdp: 'v=0\r\ngathered-offer', context: 'User: Plan Atlas.\nSky: Start with a demo.' },
      { type: 'answer', sdp: 'test-answer' },
      [],
      'starting',
    ],
  })
  warm.resolve()
  await settle()
  assert({
    given: 'session.started and ready playback',
    should: 'open with a Live instruction append and no speech response trigger',
    actual: [h.controller.state.phase, peer.dc.sent, h.audio.sink],
    expected: [
      'live',
      [{ type: 'session.instructions.append', content: 'Say hello, then listen.', delegation_id: null }],
      'headphones',
    ],
  })
  await h.close()
})

test('delegated parallel tools run once and resume only after every output has arrived', async () => {
  const h = harness()
  const first = deferred<string>(),
    second = deferred<string>()
  h.outputs.set('read_file', first.promise)
  h.outputs.set('search_email', second.promise)
  const peer = await h.open()
  backend(peer, { type: 'response.created', response: { id: 'response-1' } })
  backend(peer, { type: 'response.function_call_arguments.done', response_id: 'response-1' })
  requestTool(peer, 'read_file', 'call-a')
  requestTool(peer, 'read_file', 'call-a')
  requestTool(peer, 'search_email', 'call-b')
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  second.resolve('sent evidence')
  await settle()
  assert({
    given: 'duplicate item events and one of two tools still running',
    should: 'execute each call once and retain the pending continuation',
    actual: [
      h.requests.filter((item) => item.url.endsWith('/tools')).map((item) => [item.body.name, item.body.delegationId]),
      peer.dc.sent.filter((item) => item.type === 'response.create').length,
      h.controller.state.processing,
    ],
    expected: [
      [
        ['read_file', 'task-1'],
        ['search_email', 'task-1'],
      ],
      0,
      1,
    ],
  })
  first.resolve('notebook evidence')
  await settle()
  assert({
    given: 'all results are ready',
    should: 'append matched outputs before exactly one backend continuation',
    actual: peer.dc.sent.slice(1),
    expected: [
      {
        type: 'response.item.create',
        item: { type: 'function_call_output', call_id: 'call-a', output: 'notebook evidence' },
      },
      {
        type: 'response.item.create',
        item: { type: 'function_call_output', call_id: 'call-b', output: 'sent evidence' },
      },
      { type: 'response.create' },
    ],
  })
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  await settle()
  assert({
    given: 'repeated completion',
    should: 'not repeat a continuation or side effect',
    actual: peer.dc.sent.filter((item) => item.type === 'response.create').length,
    expected: 1,
  })
  backend(peer, { type: 'response.created', response: { id: 'response-2' } })
  backend(peer, { type: 'response.completed', response: { id: 'response-2' } })
  assert({
    given: 'backend completion before speech',
    should: 'clear processing without claiming playback',
    actual: [h.controller.state.processing, h.controller.state.activity],
    expected: [0, 'listening'],
  })
  await h.close()
})

test('speech during speaker warmup suppresses a late opening greeting', async () => {
  const h = harness(),
    warm = deferred<void>()
  h.deps.warmSpeakers = () => warm.promise
  await h.controller.start()
  const peer = h.peers[0]
  peer.connect()
  peer.dc.emit({ type: 'session.input_transcript.delta', delta: 'Hello Sky.', start_ms: 0, end_ms: 500 })
  warm.resolve()
  await settle()
  assert({
    given: 'the user spoke before the speakers finished warming',
    should: 'listen without sending a second opening instruction',
    actual: [h.controller.state.phase, peer.dc.sent],
    expected: ['live', []],
  })
  await h.close()
})

test('an oversized tool result preserves the connection and asks the backend to narrow its query', async () => {
  const h = harness(),
    peer = await h.open()
  peer.sctp.maxMessageSize = 1024
  h.outputs.set('read_file', Promise.resolve('Synthetic fixture '.repeat(100)))
  requestTool(peer, 'read_file', 'call-a')
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  await settle()
  const result = peer.dc.sent.find((event) => event.type === 'response.item.create')!
  assert({
    given: 'a tool output larger than the negotiated data-channel limit',
    should: 'return a bounded actionable error and continue the backend',
    actual: [
      new TextEncoder().encode(JSON.stringify(result)).length < peer.sctp.maxMessageSize,
      JSON.parse(result.item.output).ok,
      JSON.parse(result.item.output).error.includes('narrower query'),
      peer.dc.sent.at(-1)?.type,
      h.controller.state.phase,
    ],
    expected: [true, false, true, 'response.create', 'live'],
  })
  await h.close()
})

test('overlapping and late captions retain word order while a speech interruption leaves tools running', async () => {
  const h = harness(),
    result = deferred<string>()
  h.outputs.set('read_file', result.promise)
  const peer = await h.open()
  backend(peer, { type: 'response.created', response: { id: 'response-1' } })
  requestTool(peer, 'read_file', 'call-a')
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  peer.dc.emit({
    type: 'session.input_transcript.delta',
    delta: 'I want',
    start_ms: 1000,
    end_ms: 1300,
    event_id: 'u1',
  })
  peer.dc.emit({
    type: 'session.output_transcript.delta',
    delta: 'Sure.',
    start_ms: 1350,
    end_ms: 1450,
    event_id: 'a1',
  })
  peer.dc.emit({
    type: 'session.input_transcript.delta',
    delta: ' Thursday.',
    start_ms: 1800,
    end_ms: 2000,
    event_id: 'u3',
  })
  peer.dc.emit({
    type: 'session.input_transcript.delta',
    delta: ' Thursday,',
    start_ms: 1500,
    end_ms: 1700,
    event_id: 'u2',
  })
  peer.dc.emit({
    type: 'session.input_transcript.delta',
    delta: ' Thursday,',
    start_ms: 1500,
    end_ms: 1700,
    event_id: 'u2',
  })
  assert({
    given: 'overlap, an out-of-order caption, and a duplicate event',
    should: 'preserve repeated words in timestamp order without canceling backend work',
    actual: [
      h.controller.state.turns.map((turn) => [turn.who, turn.text]),
      h.requests.find((item) => item.url.endsWith('/tools'))!.signal?.aborted,
    ],
    expected: [
      [
        ['you', 'I want Thursday, Thursday.'],
        ['sky', 'Sure.'],
      ],
      false,
    ],
  })
  result.resolve('ready')
  await settle()
  assert({
    given: 'the tool completes after the interruption',
    should: 'continue the backend',
    actual: peer.dc.sent.at(-1)?.type,
    expected: 'response.create',
  })
  await h.close()
})

test('ending cancels tools immediately and saves final captions before releasing the connection', async () => {
  const h = harness(),
    result = deferred<string>()
  h.outputs.set('read_file', result.promise)
  const peer = await h.open()
  backend(peer, { type: 'response.created', response: { id: 'response-1' } })
  requestTool(peer, 'read_file', 'call-a')
  backend(peer, { type: 'response.completed', response: { id: 'response-1' } })
  const ending = h.controller.end()
  assert({
    given: 'End during delegated work',
    should: 'stop recording and tools while awaiting final Live events',
    actual: [
      h.microphones[0].track.stopped,
      h.requests.find((item) => item.url.endsWith('/tools'))!.signal?.aborted,
      peer.dc.sent.at(-1),
      h.controller.state.phase,
    ],
    expected: [true, true, { type: 'session.close' }, 'ending'],
  })
  peer.dc.emit({ type: 'session.input_transcript.delta', delta: 'Thanks.', start_ms: 3000, end_ms: 3500 })
  peer.dc.emit({ type: 'session.closed' })
  result.resolve('late result')
  await ending
  await settle()
  assert({
    given: 'final caption drain and a late tool result',
    should: 'retain the caption, release resources, and discard the obsolete continuation',
    actual: [
      h.controller.state.phase,
      h.controller.state.turns.map((turn) => [turn.text, turn.live]),
      peer.connectionState,
      h.audio.srcObject,
      h.timers.size,
      peer.dc.sent.at(-1)?.type,
      h.requests.filter((request) => request.url.endsWith('/end')).length,
    ],
    expected: ['ended', [['Thanks.', false]], 'closed', null, 0, 'session.close', 1],
  })
})

test('a stuck startup fails with a useful error and a retry uses a new service identity', async () => {
  const h = harness()
  await h.controller.start()
  await h.runTimer(45_000)
  assert({
    given: 'no session.started event',
    should: 'stop connecting and release the microphone',
    actual: [h.controller.state.phase, h.controller.state.error, h.microphones[0].track.stopped],
    expected: ['failed', 'Voice took too long to connect. Try again.', true],
  })
  await h.open()
  assert({
    given: 'a retry',
    should: 'isolate it from a delayed end request',
    actual: h.requests.filter((item) => item.url.endsWith('/session')).map((item) => item.url),
    expected: ['/voice/test-call-1/session', '/voice/test-call-2/session'],
  })
  await h.close()
})

test('provider startup and asynchronous backend validation failures retain their actual message', async () => {
  const h = harness()
  const fetcher = h.deps.fetch
  h.deps.fetch = (url, init) =>
    String(url).endsWith('/session')
      ? Promise.resolve(Response.json({ message: 'The model is unavailable to this project.' }, { status: 502 }))
      : fetcher(url, init)
  await h.controller.start()
  assert({
    given: 'a rejected Live handshake',
    should: 'show its cause and release recording',
    actual: [h.controller.state.error, h.microphones[0].track.stopped],
    expected: ['The model is unavailable to this project.', true],
  })
  h.deps.fetch = fetcher
  const peer = await h.open()
  peer.dc.emit({
    type: 'error',
    error: { code: 'responses_validation_failed', message: 'Backend configuration rejected.' },
  })
  assert({
    given: 'asynchronous Responses validation',
    should: 'end an unusable call with the provider error',
    actual: [h.controller.state.phase, h.controller.state.error, peer.connectionState],
    expected: ['failed', 'Backend configuration rejected.', 'closed'],
  })
})

test('mute and microphone replacement preserve the selected recording state', async () => {
  const h = harness()
  await h.open()
  h.controller.setMuted(true)
  await h.controller.chooseInput('replacement')
  h.controller.chooseOutput('headphones')
  await settle()
  assert({
    given: 'a microphone change while muted',
    should: 'stop the old track and leave the new track muted',
    actual: [h.microphones[0].track.stopped, h.microphones[1].track.enabled, h.controller.state.muted, h.audio.sink],
    expected: [true, false, true, 'headphones'],
  })
  h.controller.setMuted(false)
  assert({
    given: 'unmute',
    should: 'enable the replacement microphone',
    actual: h.microphones[1].track.enabled,
    expected: true,
  })
  await h.close()
})

test('speaking status follows received audio instead of backend completion or caption arrival', async () => {
  const h = harness(),
    peer = await h.open()
  peer.audioLevel = 0.1
  await h.runTimer(150)
  assert({
    given: 'audible output',
    should: 'show speaking',
    actual: h.controller.state.activity,
    expected: 'speaking',
  })
  peer.audioLevel = 0
  for (let i = 0; i < 3; i++) await h.runTimer(150)
  assert({
    given: 'audio drains',
    should: 'return to listening without waiting for an obsolete response.done',
    actual: h.controller.state.activity,
    expected: 'listening',
  })
  await h.close()
})
