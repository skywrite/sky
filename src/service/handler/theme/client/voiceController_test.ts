import { assert, test } from '#test'
import {
  CALLS_URL,
  VoiceController,
  type SinkElement,
  type VoiceDependencies,
  type VoiceEvent,
} from './voiceController.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type SentEvent = {
  type: string
  item?: { type?: string; call_id?: string; output?: string; content?: Array<{ text?: string }> }
  response?: { instructions?: string }
}

class Channel {
  readyState = 'connecting'
  sent: SentEvent[] = []
  onmessage?: (message: { data: string }) => void
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  send(value: string) {
    this.sent.push(JSON.parse(value) as SentEvent)
  }
  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }
  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
  emit(event: VoiceEvent) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

class Peer {
  channel = new Channel()
  connectionState = 'new'
  tracks: MediaStreamTrack[] = []
  transceivers: unknown[] = []
  remote: unknown = null
  ontrack?: (event: { streams: MediaStream[] }) => void
  onconnectionstatechange?: () => void
  createDataChannel() {
    return this.channel
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track)
  }
  addTransceiver(kind: string, options: unknown) {
    this.transceivers.push({ kind, options })
  }
  getSenders() {
    return this.tracks.map((track) => ({ track, replaceTrack: async (_track: MediaStreamTrack) => {} }))
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'test-offer' })
  }
  setLocalDescription(_description: unknown) {
    return Promise.resolve()
  }
  setRemoteDescription(description: unknown) {
    this.remote = description
    this.channel.open()
    this.channel.emit({ type: 'session.created' })
    this.ontrack?.({ streams: [] })
    return Promise.resolve()
  }
  close() {
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }
}

function microphone() {
  let stopped = false
  const track = {
    kind: 'audio',
    stop: () => {
      stopped = true
    },
  } as MediaStreamTrack
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  return { stream, stopped: () => stopped }
}

async function settle() {
  // Drain promises through fetch, response.json, and the asynchronous tool callback.
  for (let i = 0; i < 15; i++) await Promise.resolve()
}

function harness(
  options: {
    mic?: Promise<MediaStream>
    research?: Promise<Response>
    lookup?: Promise<Response>
    session?: Promise<Response>
  } = {},
) {
  const mic = microphone()
  const peers: Peer[] = []
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const timers = new Map<number, () => void>()
  let timerSequence = 0
  const audio = () =>
    ({ muted: true, srcObject: null, pause: () => {}, play: () => Promise.resolve() }) as unknown as SinkElement
  const hostAudio = audio()
  const sunnyAudio = audio()
  const session = {
    clientSecret: 'host-test-secret',
    model: 'gpt-realtime-2.1',
    voice: 'ash',
    opening: 'Greet the user.',
    tools: ['lookup_notebook', 'research_notebook'],
    researcher: {
      clientSecret: 'sunny-test-secret',
      model: 'gpt-realtime-2.1',
      voice: 'marin',
      name: 'Sunny',
      instructions: 'You are Sunny. Report evidence in your own voice.',
    },
  }
  const deps: VoiceDependencies = {
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      if (String(url).endsWith('/session')) return options.session ?? Response.json(session)
      if (String(url) === CALLS_URL) return new Response('test-answer')
      if (String(url).endsWith('/tools')) {
        const body = JSON.parse(init?.body as string) as { name: string }
        return body.name === 'research_notebook' || body.name === 'research_web'
          ? (options.research ?? Response.json({ output: 'Atlas has two milestones.' }))
          : (options.lookup ?? Response.json({ output: 'The meeting is at three.' }))
      }
      return Response.json({ ok: true })
    }) as typeof fetch,
    createPeer: () => {
      const peer = new Peer()
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
    getUserMedia: () => options.mic ?? Promise.resolve(mic.stream),
    audio: (speaker) => (speaker === 'sky' ? hostAudio : sunnyAudio),
    warmSpeakers: () => Promise.resolve(),
    setTimer: (callback) => {
      const id = ++timerSequence
      timers.set(id, callback)
      return id
    },
    clearTimer: (id) => {
      timers.delete(id)
    },
  }
  const controller = new VoiceController('test-call', deps, () => {})
  return { controller, peers, requests, mic, timers, hostAudio, sunnyAudio, session }
}

function responses(peer: Peer) {
  return peer.channel.sent.filter((event) => event.type === 'response.create')
}
function messages(peer: Peer) {
  return peer.channel.sent.filter((event) => event.type === 'conversation.item.create')
}
function done(peer: Peer, id: string, transcript?: string) {
  peer.channel.emit({ type: 'response.created', response: { id } })
  if (transcript) {
    peer.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
    peer.channel.emit({ type: 'output_audio_buffer.started', response_id: id })
    peer.channel.emit({ type: 'response.output_audio_transcript.done', transcript })
  }
  peer.channel.emit({ type: 'response.done', response: { id, status: 'completed', output: [] } })
}
function drain(peer: Peer, id: string) {
  peer.channel.emit({ type: 'output_audio_buffer.stopped', response_id: id })
}
function user(peer: Peer, transcript = 'What is happening with Atlas?') {
  peer.channel.emit({ type: 'input_audio_buffer.speech_started' })
  peer.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
  peer.channel.emit({ type: 'input_audio_buffer.committed' })
  peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript })
}
function tool(peer: Peer, name: string, id: string, status = 'completed', itemStatus = 'completed') {
  peer.channel.emit({ type: 'response.created', response: { id } })
  peer.channel.emit({
    type: 'response.done',
    response: {
      id,
      status,
      output: [
        {
          type: 'function_call',
          status: itemStatus,
          name,
          call_id: `${id}-tool`,
          arguments: JSON.stringify(name === 'resume_research' ? {} : { question: 'What changed in Atlas?' }),
        },
      ],
    },
  })
}

function invite(peer: Peer, id: string, input: unknown = { request: 'Say hello to the user.' }) {
  peer.channel.emit({ type: 'response.created', response: { id } })
  peer.channel.emit({
    type: 'response.done',
    response: {
      id,
      status: 'completed',
      output: [
        {
          type: 'function_call',
          status: 'completed',
          name: 'invite_sunny',
          call_id: `${id}-invite`,
          arguments: JSON.stringify(input),
        },
      ],
    },
  })
}

test({ name: 'voice controller opens two calls with one microphone and a receive-only researcher' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  assert({
    given: 'two ephemeral secrets and a microphone',
    should: 'open two calls, send mic only to Sky, and greet only from Sky',
    actual: {
      peers: h.peers.length,
      hostTracks: h.peers[0]!.tracks.length,
      sunnyTracks: h.peers[1]!.tracks.length,
      sunnyReceive: h.peers[1]!.transceivers,
      hostResponses: responses(h.peers[0]!).length,
      sunnyResponses: responses(h.peers[1]!).length,
      phase: h.controller.state.phase,
      hostMuted: h.hostAudio.muted,
      sunnyMuted: h.sunnyAudio.muted,
    },
    expected: {
      peers: 2,
      hostTracks: 1,
      sunnyTracks: 0,
      sunnyReceive: [{ kind: 'audio', options: { direction: 'recvonly' } }],
      hostResponses: 1,
      sunnyResponses: 0,
      phase: 'live',
      hostMuted: false,
      sunnyMuted: true,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller mutes commentary without cancelling the lookup or its final answer' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'When is the Atlas meeting?')
  host.channel.emit({ type: 'response.created', response: { id: 'lookup' } })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'lookup',
    item: { id: 'preamble', type: 'message', phase: 'commentary' },
  })
  const mutedBeforePlayback = h.hostAudio.muted
  host.channel.emit({
    type: 'response.content_part.added',
    response_id: 'lookup',
    item_id: 'preamble',
    part: { type: 'audio' },
  })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'lookup' })
  host.channel.emit({
    type: 'response.output_audio_transcript.delta',
    response_id: 'lookup',
    item_id: 'preamble',
    delta: 'Let me check the notebook.',
  })
  host.channel.emit({
    type: 'response.output_audio_transcript.done',
    response_id: 'lookup',
    item_id: 'preamble',
    transcript: 'Let me check the notebook.',
  })
  tool(host, 'lookup_notebook', 'lookup')
  await settle()
  const whileDraining = {
    muted: h.hostAudio.muted,
    requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    responses: responses(host).length,
    displayed: h.controller.state.turns.some((turn) => turn.who === 'sky'),
    cancelledOrCleared: host.channel.sent.some(
      (event) => event.type === 'response.cancel' || event.type === 'output_audio_buffer.clear',
    ),
  }
  drain(host, 'lookup')
  const mirroredCommentary = messages(sunny).some((event) =>
    event.item?.content?.[0]?.text?.includes('Let me check the notebook.'),
  )
  host.channel.emit({ type: 'response.created', response: { id: 'answer' } })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'answer',
    item: { id: 'answer-item', type: 'message', phase: 'final_answer' },
  })
  host.channel.emit({
    type: 'response.content_part.added',
    response_id: 'answer',
    item_id: 'answer-item',
    part: { type: 'audio' },
  })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'answer' })
  host.channel.emit({
    type: 'response.output_audio_transcript.done',
    response_id: 'answer',
    item_id: 'answer-item',
    transcript: 'The meeting is at three.',
  })
  const finalAudible = !h.hostAudio.muted
  host.channel.emit({ type: 'response.done', response: { id: 'answer', status: 'completed', output: [] } })
  drain(host, 'answer')
  assert({
    given: 'a commentary audio item followed by a real lookup and a final answer',
    should: 'silence only the commentary, execute the tool, wait for drainage, and deliver the answer',
    actual: {
      mutedBeforePlayback,
      whileDraining,
      mirroredCommentary,
      finalAudible,
      responses: responses(host).length,
      spoken: h.controller.state.turns.filter((turn) => turn.who === 'sky').map((turn) => turn.text),
      mirroredAnswer: messages(sunny).some((event) =>
        event.item?.content?.[0]?.text?.includes(
          'Speaker: Sky. This records what was said, not a new request.\nThe meeting is at three.',
        ),
      ),
    },
    expected: {
      mutedBeforePlayback: true,
      whileDraining: { muted: true, requests: 1, responses: 2, displayed: false, cancelledOrCleared: false },
      mirroredCommentary: false,
      finalAudible: true,
      responses: 3,
      spoken: ['The meeting is at three.'],
      mirroredAnswer: true,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller preserves final and unknown speech items in a mixed-phase response' }, async () => {
  for (const phase of [undefined, 'future_phase']) {
    const h = harness()
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    host.channel.emit({ type: 'response.created', response: { id: 'mixed' } })
    host.channel.emit({
      type: 'response.output_item.added',
      response_id: 'mixed',
      item: { id: 'preamble', type: 'message', phase: 'commentary' },
    })
    host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'mixed' })
    host.channel.emit({
      type: 'response.output_item.added',
      response_id: 'mixed',
      item: { id: 'function', type: 'function_call' },
    })
    const mutedForFunctionItem = h.hostAudio.muted
    host.channel.emit({
      type: 'response.output_item.added',
      response_id: 'mixed',
      item: { id: 'final', type: 'message', phase: 'final_answer' },
    })
    const finalAudible = !h.hostAudio.muted
    host.channel.emit({
      type: 'response.output_audio_transcript.delta',
      response_id: 'mixed',
      item_id: 'final',
      delta: 'The meeting is at ',
    })
    host.channel.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'mixed',
      item_id: 'final',
      transcript: 'The meeting is at three.',
    })
    // A late commentary transcript belongs to its own item, not the current final item.
    host.channel.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'mixed',
      item_id: 'preamble',
      transcript: 'I will investigate that.',
    })
    host.channel.emit({
      type: 'response.output_item.added',
      response_id: 'mixed',
      item: { id: 'another-answer', type: 'message', phase },
    })
    const unknownAudible = !h.hostAudio.muted
    host.channel.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'mixed',
      item_id: 'another-answer',
      transcript: 'It lasts an hour.',
    })
    host.channel.emit({ type: 'response.done', response: { id: 'mixed', status: 'completed', output: [] } })
    drain(host, 'mixed')
    assert({
      given: `commentary, a tool item, a final answer, and a ${phase ?? 'legacy'} speech item in one response`,
      should: 'unmute the answers promptly, keep both transcripts, and leave the shared audio buffer intact',
      actual: {
        mutedForFunctionItem,
        finalAudible,
        unknownAudible,
        spoken: h.controller.state.turns.map((turn) => turn.text),
        mirrored: messages(sunny).at(-1)?.item?.content?.[0]?.text,
        cleared: host.channel.sent.some((event) => event.type === 'output_audio_buffer.clear'),
      },
      expected: {
        mutedForFunctionItem: true,
        finalAudible: true,
        unknownAudible: true,
        spoken: ['The meeting is at three. It lasts an hour.'],
        mirrored:
          'Conversation record. Speaker: Sky. This records what was said, not a new request.\nThe meeting is at three. It lasts an hour.',
        cleared: false,
      },
    })
    h.controller.end()
  }
})

test({ name: 'voice controller never lets interrupted or stale item phases restore playback' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const host = h.peers[0]!
  host.channel.emit({ type: 'response.created', response: { id: 'old' } })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'old',
    item: { id: 'old-commentary', type: 'message', phase: 'commentary' },
  })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'old' })
  host.channel.emit({ type: 'input_audio_buffer.speech_started' })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'old',
    item: { id: 'interrupted-final', type: 'message', phase: 'final_answer' },
  })
  const mutedDuringInterruption = h.hostAudio.muted
  host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
  host.channel.emit({ type: 'input_audio_buffer.committed' })
  host.channel.emit({ type: 'response.done', response: { id: 'old', status: 'cancelled' } })
  host.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'old' })
  host.channel.emit({ type: 'response.created', response: { id: 'new' } })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'new',
    item: { id: 'new-commentary', type: 'message', phase: 'commentary' },
  })
  // A delayed acknowledgement must not turn an old item into the new response's phase.
  host.channel.emit({ type: 'response.created', response: { id: 'old' } })
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'old',
    item: { id: 'stale-final', type: 'message', phase: 'final_answer' },
  })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'old' })
  host.channel.emit({
    type: 'response.output_audio_transcript.done',
    response_id: 'old',
    item_id: 'stale-final',
    transcript: 'A stale answer.',
  })
  const mutedAfterStaleEvents = h.hostAudio.muted
  host.channel.emit({
    type: 'response.output_item.added',
    response_id: 'new',
    item: { id: 'new-final', type: 'message', phase: 'final_answer' },
  })
  assert({
    given: 'final-phase events after barge-in and from an older response',
    should: 'keep them muted and excluded while allowing the current answer to speak',
    actual: {
      mutedDuringInterruption,
      mutedAfterStaleEvents,
      currentAudible: !h.hostAudio.muted,
      staleDisplayed: h.controller.state.turns.some((turn) => turn.text.includes('stale')),
    },
    expected: {
      mutedDuringInterruption: true,
      mutedAfterStaleEvents: true,
      currentAudible: true,
      staleDisplayed: false,
    },
  })
  h.controller.end()
})

test(
  { name: 'voice controller ignores late final items from the participant who no longer owns the floor' },
  async () => {
    const h = harness()
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, 'Sunny, say hello.')
    invite(host, 'invite')
    done(sunny, 'sunny-hello', 'Hey.')
    drain(sunny, 'sunny-hello')
    user(host, 'Sky, what is seven plus five?')
    host.channel.emit({ type: 'response.created', response: { id: 'host-answer' } })
    sunny.channel.emit({ type: 'response.created', response: { id: 'sunny-hello' } })
    sunny.channel.emit({
      type: 'response.output_item.added',
      response_id: 'sunny-hello',
      item: { id: 'late-sunny-final', type: 'message', phase: 'final_answer' },
    })
    sunny.channel.emit({
      type: 'response.content_part.added',
      response_id: 'sunny-hello',
      item_id: 'late-sunny-final',
      part: { type: 'audio' },
    })
    sunny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'sunny-hello' })
    assert({
      given: 'late final/audio events from Sunny while Sky is answering the next user turn',
      should: 'keep Sunny silent and preserve Sky’s speaking floor',
      actual: {
        hostMuted: h.hostAudio.muted,
        sunnyMuted: h.sunnyAudio.muted,
        speaker: h.controller.state.speaker,
      },
      expected: { hostMuted: false, sunnyMuted: true, speaker: 'sky' },
    })
    h.controller.end()
  },
)

test({ name: 'voice controller invites Sunny into conversation directly after Sky’s playback finishes' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Sunny, say hello.')
  host.channel.emit({ type: 'response.created', response: { id: 'invite' } })
  host.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'invite' })
  host.channel.emit({ type: 'response.output_audio_transcript.done', transcript: 'Sure.' })
  invite(host, 'invite')
  const beforeDrain = responses(sunny).length
  drain(host, 'invite')
  const invited = {
    responses: responses(sunny).length,
    research: h.controller.state.research,
    hostResponses: responses(host).length,
    request: messages(sunny).some(
      (event) =>
        event.item?.content?.[0]?.text === 'Live conversational request addressed to Sunny:\nSay hello to the user.',
    ),
    context: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes('Sunny, say hello.')),
    instructions: responses(sunny).at(-1)?.response?.instructions?.includes('The invitation does not expand'),
  }
  done(sunny, 'hello', 'Hello! I’m Sunny.')
  const mirroredBeforeDrain = messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sunny'))
  drain(sunny, 'hello')
  assert({
    given: 'the user asks Sunny to say hello while Sky’s final audio is still playing',
    should:
      'yield directly to Sunny without research, mirror her delivered answer, and never generate an extra Sky handoff',
    actual: {
      beforeDrain,
      invited,
      mirroredBeforeDrain,
      mirroredAfterDrain: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sunny')),
      hostResponsesAfterSunny: responses(host).length,
      backendRequests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: {
      beforeDrain: 0,
      invited: {
        responses: 1,
        research: { running: 0, ready: 0, paused: 0 },
        hostResponses: 2,
        request: true,
        context: true,
        instructions: true,
      },
      mirroredBeforeDrain: false,
      mirroredAfterDrain: true,
      hostResponsesAfterSunny: 2,
      backendRequests: 0,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller gives Sunny quick web evidence before a same-batch invitation' }, async () => {
  const lookup = deferred<Response>()
  const h = harness({ lookup: lookup.promise })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Sunny, check the public status reference and explain it.')
  host.channel.emit({ type: 'response.created', response: { id: 'lookup-and-invite' } })
  host.channel.emit({
    type: 'response.done',
    response: {
      id: 'lookup-and-invite',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          status: 'completed',
          name: 'lookup_web',
          call_id: 'quick-web',
          arguments: JSON.stringify({ question: 'What does status 429 mean on the public reference page?' }),
        },
        {
          type: 'function_call',
          status: 'completed',
          name: 'invite_sunny',
          call_id: 'answer-invitation',
          arguments: JSON.stringify({ request: 'Explain the status reference to the user.' }),
        },
      ],
    },
  })
  const beforeLookup = responses(sunny).length
  const evidence = 'Status 429 indicates rate limiting. Source: https://example.com/status/429'
  lookup.resolve(Response.json({ output: evidence }))
  await settle()
  const records = messages(sunny).map((event) => event.item?.content?.[0]?.text ?? '')
  const evidenceIndex = records.findIndex((text) => text.includes(evidence))
  const invitationIndex = records.findIndex((text) => text.startsWith('Live conversational request'))
  assert({
    given: 'a quick public lookup and invitation in the same host tool batch',
    should: 'supply the actual source result before Sunny answers, without another Sky reply or research job',
    actual: {
      beforeLookup,
      sunnyResponses: responses(sunny).length,
      evidenceBeforeRequest: evidenceIndex >= 0 && evidenceIndex < invitationIndex,
      hostResponses: responses(host).length,
      backendRequests: h.requests.filter((entry) => entry.url.endsWith('/tools')).length,
      research: h.controller.state.research,
    },
    expected: {
      beforeLookup: 0,
      sunnyResponses: 1,
      evidenceBeforeRequest: true,
      hostResponses: 2,
      backendRequests: 1,
      research: { running: 0, ready: 0, paused: 0 },
    },
  })
  h.controller.end()
})

test(
  { name: 'voice controller shares bounded task and mail evidence before Sunny gives a second opinion' },
  async () => {
    for (const name of ['search_email', 'google_email_read', 'google_email_inbox_view', 'day_items']) {
      const pending = deferred<Response>()
      const h = harness({ lookup: pending.promise })
      await h.controller.start()
      await settle()
      const [host, sunny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host, 'I already sent the Atlas update. Check it and let Sunny weigh in.')
      host.channel.emit({ type: 'response.created', response: { id: 'verify-and-invite' } })
      host.channel.emit({
        type: 'response.done',
        response: {
          id: 'verify-and-invite',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              status: 'completed',
              name,
              call_id: 'verify',
              arguments: JSON.stringify(name === 'search_email' ? { query: 'in:sent Atlas' } : {}),
            },
            {
              type: 'function_call',
              status: 'completed',
              name: 'invite_sunny',
              call_id: 'opinion',
              arguments: JSON.stringify({ request: 'Reassess the priorities using the current completion evidence.' }),
            },
          ],
        },
      })
      const beforeEvidence = responses(sunny).length
      pending.resolve(Response.json({ output: 'Verified Atlas completion evidence. ' + 'x'.repeat(30_000) }))
      await settle()
      const records = messages(sunny).map((event) => event.item?.content?.[0]?.text ?? '')
      const evidenceIndex = records.findIndex((text) => text.includes('Verified Atlas completion evidence.'))
      const invitationIndex = records.findIndex((text) => text.startsWith('Live conversational request'))
      const excerpt = records[evidenceIndex] ?? ''
      assert({
        given: `a ${name} result and a second-opinion invitation in the same tool batch`,
        should: 'share actual bounded evidence before Sunny speaks, preserving the fact that it is a partial excerpt',
        actual: [
          beforeEvidence,
          responses(sunny).length,
          evidenceIndex >= 0 && evidenceIndex < invitationIndex,
          excerpt.includes(name),
          excerpt.includes('Shared excerpt truncated'),
          excerpt.length < 24_200,
          h.requests.filter((request) => request.url.endsWith('/tools')).length,
        ],
        expected: [0, 1, true, true, true, true, 1],
      })
      h.controller.end()
    }
  },
)

test({ name: 'voice controller does not share draft actions as read-only source evidence' }, async () => {
  const h = harness({ lookup: Promise.resolve(Response.json({ output: 'Draft action result.' })) })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'google_email_draft_new', 'draft')
  await settle()
  assert({
    given: 'a draft action result',
    should: 'exclude it from the read-only evidence feed',
    actual: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes('Draft action result.')),
    expected: false,
  })
  h.controller.end()
})

test({ name: 'voice controller drops a queued invitation when the user speaks again' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Let Sunny introduce herself.')
  host.channel.emit({ type: 'response.created', response: { id: 'invite' } })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'invite' })
  invite(host, 'invite')
  user(host, 'Actually, stay with me for a moment.')
  host.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'invite' })
  done(host, 'latest-answer')
  assert({
    given: 'a newer user turn supersedes a queued invitation',
    should: 'answer the new turn and not deliver the outdated invitation',
    actual: {
      sunnyResponses: responses(sunny).length,
      hostResponses: responses(host).length,
      research: h.controller.state.research,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { sunnyResponses: 0, hostResponses: 3, research: { running: 0, ready: 0, paused: 0 }, requests: 0 },
  })
  h.controller.end()
})

test({ name: 'voice controller keeps research queued when a conversational Sunny turn is interrupted' }, async () => {
  const research = deferred<Response>()
  const h = harness({ research: research.promise })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  user(host, 'Sunny, introduce yourself while the research runs.')
  invite(host, 'invite')
  done(sunny, 'hello', 'Hello! I’m here to help.')
  research.resolve(Response.json({ output: 'The Atlas note records two milestones.' }))
  await settle()
  user(host, 'Thanks, that is enough for the introduction.')
  const interrupted = { research: h.controller.state.research, muted: h.sunnyAudio.muted }
  sunny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'hello' })
  done(host, 'acknowledgement')
  assert({
    given: 'the user interrupts Sunny’s introduction while a research report is ready',
    should:
      'stop the introduction without creating a paused report, retain the actual research, and deliver it after the new turn',
    actual: {
      interrupted,
      sunnyResponses: responses(sunny).length,
      researchRequests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      report: messages(sunny).some((event) =>
        event.item?.content?.[0]?.text?.includes('The Atlas note records two milestones.'),
      ),
      mirroredUnheardHello: messages(host).some((event) =>
        event.item?.content?.[0]?.text?.includes('Hello! I’m here to help.'),
      ),
    },
    expected: {
      interrupted: { research: { running: 0, ready: 1, paused: 0 }, muted: true },
      sunnyResponses: 2,
      researchRequests: 1,
      report: true,
      mirroredUnheardHello: false,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller rejects invalid invitations locally and truthfully' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  const invalid = [
    { request: '' },
    { request: '   ' },
    { request: 'x'.repeat(12_001) },
    { request: 'Say hello.', extra: true },
  ]
  for (let i = 0; i < invalid.length; i++) {
    user(host, 'Invite Sunny.')
    invite(host, `invalid-${i}`, invalid[i])
    done(host, `explain-${i}`)
  }
  assert({
    given: 'empty, whitespace-only, oversized, or extra invitation arguments',
    should: 'return an honest local failure for Sky to explain without opening research or making Sunny speak',
    actual: {
      rejected: messages(host).filter((event) => event.item?.output?.startsWith('Sunny was not invited:')).length,
      sunnyResponses: responses(sunny).length,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      research: h.controller.state.research,
    },
    expected: { rejected: 4, sunnyResponses: 0, requests: 0, research: { running: 0, ready: 0, paused: 0 } },
  })
  h.controller.end()
})

test({ name: 'voice controller ignores an invitation from a tool batch superseded during a lookup' }, async () => {
  const lookup = deferred<Response>()
  const h = harness({ lookup: lookup.promise })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Look that up and ask Sunny to explain.')
  host.channel.emit({ type: 'response.created', response: { id: 'batch' } })
  host.channel.emit({
    type: 'response.done',
    response: {
      id: 'batch',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          status: 'completed',
          name: 'lookup_notebook',
          call_id: 'lookup',
          arguments: JSON.stringify({ question: 'When is the Atlas meeting?' }),
        },
        {
          type: 'function_call',
          status: 'completed',
          name: 'invite_sunny',
          call_id: 'invite',
          arguments: JSON.stringify({ request: 'Explain the meeting plan.' }),
        },
      ],
    },
  })
  user(host, 'Change of plan, stay with me.')
  lookup.resolve(Response.json({ output: 'The meeting is at three.' }))
  await settle()
  done(host, 'latest-answer')
  assert({
    given: 'a slow lookup precedes an invitation in a batch, and the user changes the request meanwhile',
    should: 'drop the late invitation and follow the new request',
    actual: {
      sunnyResponses: responses(sunny).length,
      cancelled: messages(host).some((event) =>
        event.item?.output?.includes('earlier invitation to Sunny was cancelled'),
      ),
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { sunnyResponses: 0, cancelled: true, requests: 1 },
  })
  h.controller.end()
})

test(
  { name: 'voice controller lets Sky continue while Astra researches and waits for actual playback to end' },
  async () => {
    const research = deferred<Response>()
    const h = harness({ research: research.promise })
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting', 'Hello.')
    drain(host, 'greeting')
    user(host)
    tool(host, 'research_notebook', 'research-request')
    const started = {
      hostResponses: responses(host).length,
      sunnyResponses: responses(sunny).length,
      running: h.controller.state.research.running,
      acknowledged: messages(host).some((event) => event.item?.output?.includes('Sunny is researching')),
    }
    user(host, 'While she looks, what is six times seven?')
    done(host, 'host-continues', 'Forty-two.')
    research.resolve(Response.json({ output: 'Atlas changed on 2026-01-12, according to the project note.' }))
    await settle()
    const waiting = {
      sunnyResponses: responses(sunny).length,
      ready: h.controller.state.research.ready,
      evidence: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Atlas changed')),
    }
    drain(host, 'host-continues')
    const reporting = {
      hostResponses: responses(host).length,
      sunnyResponses: responses(sunny).length,
      hostMuted: h.hostAudio.muted,
      sunnyMuted: h.sunnyAudio.muted,
    }
    done(sunny, 'sunny-report', 'The project note says Atlas changed on January twelfth.')
    const beforeDrain = messages(host).filter((event) =>
      event.item?.content?.[0]?.text?.includes('Speaker: Sunny'),
    ).length
    drain(sunny, 'sunny-report')
    assert({
      given: 'research completes while Sky still has buffered audio',
      should: 'yield until asked, wait for playback, then let Sunny report and share her evidence after delivery',
      actual: {
        started,
        waiting,
        reporting,
        beforeDrain,
        mirrored: messages(host).filter((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sunny')).length,
        evidenceAfterDelivery: messages(host).some((event) =>
          event.item?.content?.[0]?.text?.includes('Atlas changed on 2026-01-12'),
        ),
        userMirrored: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: User')),
        hostResponsesAfterReport: responses(host).length,
      },
      expected: {
        started: { hostResponses: 2, sunnyResponses: 0, running: 1, acknowledged: true },
        waiting: { sunnyResponses: 0, ready: 1, evidence: false },
        reporting: { hostResponses: 3, sunnyResponses: 1, hostMuted: true, sunnyMuted: false },
        beforeDrain: 0,
        mirrored: 1,
        evidenceAfterDelivery: true,
        userMirrored: true,
        hostResponsesAfterReport: 3,
      },
    })
    h.controller.end()
  },
)

test({ name: 'voice controller gives Sunny ownership when quick and deep tools complete together' }, async () => {
  const research = deferred<Response>()
  const h = harness({
    research: research.promise,
    lookup: Promise.resolve(Response.json({ output: 'The Widget has a one-year warranty.' })),
  })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Do deep research comparing the public Widget specifications.')
  host.channel.emit({ type: 'response.created', response: { id: 'compare' } })
  host.channel.emit({
    type: 'response.done',
    response: {
      id: 'compare',
      status: 'completed',
      output: ['lookup_web', 'research_web'].map((name) => ({
        type: 'function_call',
        status: 'completed',
        name,
        call_id: `${name}-comparison`,
        arguments: JSON.stringify({ question: 'Compare the public Widget specifications.' }),
      })),
    },
  })
  await settle()
  const waiting = { sky: responses(host).length, sunny: responses(sunny).length }
  const output = JSON.stringify({
    status: 'partial',
    answer: 'Widget Plus doubles the warranty. The standard Widget costs less, so the extra coverage is the tradeoff.',
    reason: 'One independent review failed to load; both manufacturer specifications were read.',
    paths: [],
    urls: ['https://example.com/specifications'],
  })
  research.resolve(Response.json({ output }))
  await settle()
  assert({
    given: 'a quick fact and a partial deep report for the same requested investigation',
    should:
      'let Sunny give the supported comparison without another Sky answer or treating partial research as failure',
    actual: {
      waiting,
      sky: responses(host).length,
      sunny: responses(sunny).length,
      priorEvidence: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes('one-year warranty')),
      report: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      prematureSkyEvidence: messages(host).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      error: h.controller.state.error,
    },
    expected: {
      waiting: { sky: 2, sunny: 0 },
      sky: 2,
      sunny: 1,
      priorEvidence: true,
      report: true,
      prematureSkyEvidence: false,
      error: null,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller still answers independent tool results while Sunny researches' }, async () => {
  for (const name of ['day_items', 'google_email_draft_new', 'lookup_web']) {
    const research = deferred<Response>()
    const output =
      name === 'google_email_draft_new'
        ? JSON.stringify({ needsConfirmation: true, approvalId: 'draft-review', summary: 'Save a draft for Jane Doe.' })
        : 'The separate requested detail is available.'
    const h = harness({ research: research.promise, lookup: Promise.resolve(Response.json({ output })) })
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, 'Have Sunny research Widget specifications and help with this separate request.')
    host.channel.emit({ type: 'response.created', response: { id: 'separate' } })
    host.channel.emit({
      type: 'response.done',
      response: {
        id: 'separate',
        status: 'completed',
        output: ['research_web', name].map((toolName, index) => ({
          type: 'function_call',
          status: 'completed',
          name: toolName,
          call_id: `separate-${index}`,
          arguments: JSON.stringify({
            question: index === 0 ? 'Compare Widget specifications.' : 'A separate request.',
          }),
        })),
      },
    })
    await settle()
    assert({
      given: `a research request with an independent ${name} result in the same batch`,
      should: 'leave research running and let Sky answer the independent request or ask for draft confirmation',
      actual: {
        sky: responses(host).length,
        sunny: responses(sunny).length,
        running: h.controller.state.research.running,
        result: messages(host).some((event) => event.item?.output === output),
      },
      expected: { sky: 3, sunny: 0, running: 1, result: true },
    })
    h.controller.end()
    research.resolve(Response.json({ output: 'A late result after the call ended.' }))
    await settle()
  }
})

test({ name: 'voice controller retains research when Sunny completes without audible words' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  done(sunny, 'silent-report')
  const paused = h.controller.state.research.paused
  const evidence = messages(host).some((event) =>
    event.item?.content?.[0]?.text?.includes('research Sunny just delivered'),
  )
  h.controller.resumeResearch()
  assert({
    given: 'Sunny completes the presentation response without any audible transcript',
    should: 'keep the unheard report for resume and avoid telling Sky it was delivered',
    actual: { paused, evidence, presentations: responses(sunny).length },
    expected: { paused: 1, evidence: false, presentations: 2 },
  })
  h.controller.end()
})

test({ name: 'voice controller distinguishes a failed research attempt from existing lookup evidence' }, async () => {
  const h = harness({
    lookup: Promise.resolve(Response.json({ output: 'The official Widget warranty lasts one year.' })),
    research: Promise.resolve(
      Response.json({
        output: JSON.stringify({ status: 'failed', answer: 'The deeper search did not finish.', paths: [] }),
      }),
    ),
  })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'What is the Widget warranty?')
  tool(host, 'lookup_web', 'lookup')
  await settle()
  done(host, 'quick-answer')
  user(host, 'Now have Sunny investigate the alternatives.')
  tool(host, 'research_web', 'research')
  await settle()
  assert({
    given: 'a failed deeper search after a successful quick lookup',
    should: 'retain the successful evidence and deliver one distinct failure notice without a Sky fallback turn',
    actual: {
      priorEvidence: messages(sunny).some((event) =>
        event.item?.content?.[0]?.text?.includes('official Widget warranty'),
      ),
      failedAttempt: messages(sunny).some((event) =>
        event.item?.content?.[0]?.text?.startsWith('Research attempt did not finish. Status: failed.'),
      ),
      reports: messages(sunny).filter((event) =>
        event.item?.content?.[0]?.text?.startsWith('Research report to deliver'),
      ).length,
      sky: responses(host).length,
      sunny: responses(sunny).length,
      error: h.controller.state.error,
    },
    expected: {
      priorEvidence: true,
      failedAttempt: true,
      reports: 0,
      sky: 4,
      sunny: 1,
      error: 'Sunny’s research did not finish.',
    },
  })
  h.controller.end()
})

test({ name: 'voice controller sends public web research to Sunny without adding private conversation' }, async () => {
  const research = deferred<Response>()
  const h = harness({ research: research.promise })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'My private Atlas plan involves Jane Doe.')
  done(host, 'private-answer')
  user(host, 'Compare the public release notes.')
  const question = 'Compare the public Widget release notes for versions one and two.'
  host.channel.emit({ type: 'response.created', response: { id: 'web-request' } })
  host.channel.emit({
    type: 'response.done',
    response: {
      id: 'web-request',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          status: 'completed',
          name: 'research_web',
          call_id: 'web-tool',
          arguments: JSON.stringify({ question }),
        },
      ],
    },
  })
  const running = h.controller.state.research.running
  const beforeResult = responses(sunny).length
  const output = 'The publisher says version two adds export. Source: https://example.com/releases'
  research.resolve(Response.json({ output }))
  await settle()
  const request = h.requests.find((entry) => entry.url.endsWith('/tools'))!
  const body = JSON.parse(request.init!.body as string) as { name: string; arguments: string }
  assert({
    given: 'public web research after an unrelated private conversation',
    should: 'run in the background, preserve the public question, and deliver the cited result in Sunny’s voice',
    actual: {
      running,
      beforeResult,
      name: body.name,
      question: JSON.parse(body.arguments).question,
      sunnyResponses: responses(sunny).length,
      sourceDelivered: messages(sunny).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      sourceAvailableToSky: messages(host).some((event) => event.item?.content?.[0]?.text?.includes(output)),
    },
    expected: {
      running: 1,
      beforeResult: 0,
      name: 'research_web',
      question,
      sunnyResponses: 1,
      sourceDelivered: true,
      sourceAvailableToSky: false,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller gives user barge-in priority and retains the interrupted Sunny report' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  sunny.channel.emit({ type: 'response.created', response: { id: 'report' } })
  sunny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'report' })
  sunny.channel.emit({ type: 'response.output_audio_transcript.delta', delta: 'The findings are' })
  host.channel.emit({ type: 'input_audio_buffer.speech_started' })
  const interrupted = {
    muted: h.sunnyAudio.muted,
    cancelled: sunny.channel.sent.some((event) => event.type === 'response.cancel'),
    cleared: sunny.channel.sent.some((event) => event.type === 'output_audio_buffer.clear'),
    paused: h.controller.state.research.paused,
  }
  host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
  const beforeCommit = responses(host).length
  host.channel.emit({ type: 'input_audio_buffer.committed' })
  const beforeClear = responses(host).length
  sunny.channel.emit({ type: 'response.done', response: { id: 'report', status: 'cancelled' } })
  sunny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'report' })
  done(host, 'user-followup')
  const beforeResume = responses(sunny).length
  h.controller.resumeResearch()
  assert({
    given: 'the user interrupts a report and then finishes speaking',
    should:
      'silence Sunny immediately, wait for committed input and cleared audio, answer the user, and resume only when requested',
    actual: {
      interrupted,
      beforeCommit,
      beforeClear,
      afterClear: responses(host).length,
      beforeResume,
      afterResume: responses(sunny).length,
      interruptedTranscript: h.controller.state.turns.some((turn) => turn.who === 'sunny' && turn.interrupted),
      mirroredUnheard: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sunny')),
    },
    expected: {
      interrupted: { muted: true, cancelled: true, cleared: true, paused: 1 },
      beforeCommit: 2,
      beforeClear: 2,
      afterClear: 3,
      beforeResume: 1,
      afterResume: 2,
      interruptedTranscript: true,
      mirroredUnheard: false,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller never executes cancelled or incomplete tool calls' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const host = h.peers[0]!
  tool(host, 'lookup_notebook', 'cancelled', 'cancelled')
  user(host)
  tool(host, 'lookup_notebook', 'incomplete', 'completed', 'incomplete')
  user(host)
  host.channel.emit({ type: 'response.created', response: { id: 'barge-race' } })
  host.channel.emit({ type: 'input_audio_buffer.speech_started' })
  tool(host, 'lookup_notebook', 'barge-race')
  await settle()
  assert({
    given: 'cancelled output, incomplete arguments, and a completed response racing with barge-in',
    should: 'never send those calls to the service',
    actual: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    expected: 0,
  })
  h.controller.end()
})

test(
  { name: 'voice controller releases cancelled and failed audio that never reached the output buffer' },
  async () => {
    const h = harness()
    await h.controller.start()
    await settle()
    const host = h.peers[0]!
    host.channel.emit({ type: 'response.created', response: { id: 'greeting' } })
    host.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
    host.channel.emit({ type: 'input_audio_buffer.speech_started' })
    host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
    host.channel.emit({ type: 'input_audio_buffer.committed' })
    host.channel.emit({ type: 'response.done', response: { id: 'greeting', status: 'cancelled' } })
    const afterCancel = responses(host).length
    host.channel.emit({ type: 'response.created', response: { id: 'failed-answer' } })
    host.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
    host.channel.emit({ type: 'response.done', response: { id: 'failed-answer', status: 'failed' } })
    const afterFailure = h.controller.state.activity
    user(host)
    assert({
      given: 'an audio content part is allocated but cancelled or failed before output_audio_buffer.started',
      should:
        'avoid clearing a nonexistent buffer and release the floor without waiting for an event that cannot arrive',
      actual: {
        afterCancel,
        afterFailure,
        afterNewUser: responses(host).length,
        clears: host.channel.sent.filter((event) => event.type === 'output_audio_buffer.clear').length,
      },
      expected: { afterCancel: 2, afterFailure: 'listening', afterNewUser: 3, clears: 0 },
    })
    h.controller.end()
  },
)

test({ name: 'voice controller resumes Sunny by spoken tool without another research request' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  sunny.channel.emit({ type: 'response.created', response: { id: 'report' } })
  sunny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'report' })
  user(host, 'Pause there.')
  sunny.channel.emit({ type: 'response.done', response: { id: 'report', status: 'cancelled' } })
  sunny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'report' })
  done(host, 'pause-ack')
  user(host, 'Sunny, continue your report.')
  const hostBeforeResume = responses(host).length
  tool(host, 'resume_research', 'resume')
  const extraHostReply = responses(host).length > hostBeforeResume
  const resumed = responses(sunny).length
  done(sunny, 'finished-report', 'The project has two milestones.')
  drain(sunny, 'finished-report')
  user(host, 'Continue.')
  tool(host, 'resume_research', 'nothing-waiting')
  assert({
    given: 'a paused report followed by a spoken request to continue, then another request after delivery',
    should: 'resume locally at the next pause and truthfully report when no paused report remains',
    actual: {
      extraHostReply,
      resumed,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      acknowledged: messages(host).some((event) => event.item?.output?.includes('Sunny will continue')),
      noReport: messages(host).some((event) => event.item?.output === 'No interrupted research report is waiting.'),
    },
    expected: { extraHostReply: false, resumed: 2, requests: 1, acknowledged: true, noReport: true },
  })
  h.controller.end()
})

test({ name: 'voice controller can yield to ready findings while answering a research status question' }, async () => {
  const research = deferred<Response>()
  const h = harness({ research: research.promise })
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  user(host, 'Sunny, what did you find?')
  research.resolve(
    Response.json({
      output: JSON.stringify({ status: 'complete', answer: 'The second milestone is delayed.', paths: [] }),
    }),
  )
  await settle()
  const queued = h.controller.state.research.ready
  const statusKnown = messages(host).some((event) => event.item?.content?.[0]?.text?.includes('findings are queued'))
  const prematureEvidence = messages(host).some((event) =>
    event.item?.content?.[0]?.text?.includes('milestone is delayed'),
  )
  const hostBeforeResume = responses(host).length
  tool(host, 'resume_research', 'ready-report')
  assert({
    given: 'research finishes while Sky is handling the user’s question about its progress',
    should: 'give Sky status without findings and yield to the ready report without another lookup or host reply',
    actual: {
      queued,
      statusKnown,
      prematureEvidence,
      extraHostReply: responses(host).length > hostBeforeResume,
      sunny: responses(sunny).length,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { queued: 1, statusKnown: true, prematureEvidence: false, extraHostReply: false, sunny: 1, requests: 1 },
  })
  h.controller.end()
})

test({ name: 'voice controller retains Sunny’s report when response.create is refused' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sunny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  // The rejected request never receives response.created or response.done.
  sunny.channel.emit({ type: 'error', error: { message: 'The response could not be created.' } })
  const rejected = {
    paused: h.controller.state.research.paused,
    activity: h.controller.state.activity,
    error: h.controller.state.error,
    muted: h.sunnyAudio.muted,
  }
  user(host, 'Sunny, try that report again.')
  tool(host, 'resume_research', 'resume')
  done(host, 'resume-ack')
  assert({
    given: 'Sunny’s response.create is refused before generation starts',
    should: 'retain the undelivered report for a local retry and keep the rejection visible',
    actual: {
      rejected,
      responses: responses(sunny).length,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      pausedAfterResume: h.controller.state.research.paused,
      errorAfterResume: h.controller.state.error,
    },
    expected: {
      rejected: { paused: 1, activity: 'listening', error: 'The response could not be created.', muted: true },
      responses: 2,
      requests: 1,
      pausedAfterResume: 0,
      errorAfterResume: 'The response could not be created.',
    },
  })
  h.controller.end()
})

test({ name: 'voice controller holds quick-tool responses while the user speaks' }, async () => {
  const lookup = deferred<Response>()
  const h = harness({ lookup: lookup.promise })
  await h.controller.start()
  await settle()
  const host = h.peers[0]!
  done(host, 'greeting')
  user(host)
  tool(host, 'lookup_notebook', 'lookup')
  host.channel.emit({ type: 'input_audio_buffer.speech_started' })
  lookup.resolve(Response.json({ output: 'The meeting is at three.' }))
  await settle()
  const duringSpeech = responses(host).length
  host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
  const beforeCommit = responses(host).length
  host.channel.emit({ type: 'input_audio_buffer.committed' })
  assert({
    given: 'a quick lookup finishes while the user is still talking',
    should: 'return the tool result silently and wait until the audio turn is committed',
    actual: {
      duringSpeech,
      beforeCommit,
      afterCommit: responses(host).length,
      output: messages(host).some((event) => event.item?.output === 'The meeting is at three.'),
    },
    expected: { duringSpeech: 2, beforeCommit: 2, afterCommit: 3, output: true },
  })
  h.controller.end()
})

test(
  { name: 'voice controller defers ready research until after the latest user turn and includes corrections' },
  async () => {
    const research = deferred<Response>()
    const h = harness({ research: research.promise })
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, `Earlier context ${'x'.repeat(15_000)}`)
    done(host, 'first-answer')
    user(host, 'Correction: the project is Atlas, not Widget.')
    tool(host, 'research_notebook', 'research')
    host.channel.emit({ type: 'input_audio_buffer.speech_started' })
    research.resolve(Response.json({ output: 'Atlas has two milestones.' }))
    await settle()
    const duringSpeech = responses(sunny).length
    host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
    const beforeCommit = responses(sunny).length
    host.channel.emit({ type: 'input_audio_buffer.committed' })
    const beforeAnswer = responses(sunny).length
    done(host, 'latest-answer', 'Yes, I heard your update.')
    drain(host, 'latest-answer')
    const request = JSON.parse(h.requests.find((item) => item.url.endsWith('/tools'))!.init!.body as string) as {
      arguments: string
    }
    const question = (JSON.parse(request.arguments) as { question: string }).question
    assert({
      given: 'a correction before research starts and another user turn while the report returns',
      should: 'send bounded conversation to Astra, let Sky answer first, and only then deliver Sunny’s report',
      actual: {
        duringSpeech,
        beforeCommit,
        beforeAnswer,
        afterAnswer: responses(sunny).length,
        bounded: question.length <= 12_000,
        corrected: question.includes('Correction: the project is Atlas, not Widget.'),
        original: question.includes('What changed in Atlas?'),
      },
      expected: {
        duringSpeech: 0,
        beforeCommit: 0,
        beforeAnswer: 0,
        afterAnswer: 1,
        bounded: true,
        corrected: true,
        original: true,
      },
    })
    h.controller.end()
  },
)

test({ name: 'voice controller cancels a pending session request without reviving the call' }, async () => {
  const session = deferred<Response>()
  const h = harness({ session: session.promise })
  const start = h.controller.start()
  await settle()
  const request = h.requests.find((item) => item.url.endsWith('/session'))!
  h.controller.end()
  session.resolve(Response.json(h.session))
  await start
  assert({
    given: 'End is clicked while the service is creating the sessions',
    should: 'abort startup and ignore its late reply',
    actual: {
      aborted: request.init?.signal?.aborted,
      mic: h.mic.stopped(),
      peers: h.peers.length,
      phase: h.controller.state.phase,
    },
    expected: { aborted: true, mic: true, peers: 0, phase: 'ended' },
  })
})

test(
  { name: 'voice controller ends during microphone permission and stops the late stream without opening calls' },
  async () => {
    const pendingMic = deferred<MediaStream>()
    const mic = microphone()
    const h = harness({ mic: pendingMic.promise })
    const start = h.controller.start()
    h.controller.end()
    pendingMic.resolve(mic.stream)
    await start
    assert({
      given: 'End is clicked before getUserMedia resolves',
      should: 'stop the eventual microphone and remain ended without minting a session',
      actual: {
        stopped: mic.stopped(),
        peers: h.peers.length,
        sessions: h.requests.filter((request) => request.url.endsWith('/session')).length,
        phase: h.controller.state.phase,
      },
      expected: { stopped: true, peers: 0, sessions: 0, phase: 'ended' },
    })
  },
)

test(
  { name: 'voice controller aborts pending research and ignores stale callbacks after End and restart' },
  async () => {
    const research = deferred<Response>()
    const h = harness({ research: research.promise })
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    tool(host, 'research_notebook', 'research')
    const request = h.requests.find((item) => item.url.endsWith('/tools'))!
    h.controller.end()
    const closed = {
      peers: h.peers.every((peer) => peer.connectionState === 'closed'),
      mic: h.mic.stopped(),
      aborted: request.init?.signal?.aborted,
      timers: h.timers.size,
    }
    await h.controller.start()
    await settle()
    const newHost = h.peers[2]!
    research.resolve(Response.json({ output: 'Stale findings.' }))
    sunny.channel.emit({ type: 'response.output_audio_transcript.done', transcript: 'Stale response.' })
    await settle()
    assert({
      given: 'a report returns after End and a new call has started',
      should: 'close both old connections, abort research, and keep old output out of the new session',
      actual: {
        closed,
        ready: h.controller.state.research.ready,
        oldText: h.controller.state.turns.some((turn) => turn.text.includes('Stale')),
        newMessages: messages(newHost).length,
        sessionRoutes: h.requests.filter((item) => item.url.endsWith('/session')).map((item) => item.url),
      },
      expected: {
        closed: { peers: true, mic: true, aborted: true, timers: 0 },
        ready: 0,
        oldText: false,
        newMessages: 0,
        sessionRoutes: ['/voice/test-call-1/session', '/voice/test-call-2/session'],
      },
    })
    h.controller.end()
  },
)

test(
  { name: 'voice controller reports a research failure in Sunny’s voice and closes both calls when a peer fails' },
  async () => {
    const h = harness({
      research: Promise.resolve(Response.json({ message: 'Research service unavailable.' }, { status: 503 })),
    })
    await h.controller.start()
    await settle()
    const [host, sunny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    tool(host, 'research_notebook', 'research')
    await settle()
    const report = {
      called: responses(sunny).length,
      failure: messages(sunny).some((event) =>
        event.item?.content?.[0]?.text?.includes('Research service unavailable'),
      ),
      warning: h.controller.state.error !== null,
    }
    sunny.connectionState = 'failed'
    sunny.onconnectionstatechange?.()
    assert({
      given: 'research errors, followed by a failed Sunny connection',
      should: 'deliver the failure honestly and stop the microphone and both sessions when the call fails',
      actual: {
        report,
        phase: h.controller.state.phase,
        stopped: h.mic.stopped(),
        closed: h.peers.every((peer) => peer.connectionState === 'closed'),
      },
      expected: { report: { called: 1, failure: true, warning: true }, phase: 'failed', stopped: true, closed: true },
    })
  },
)
