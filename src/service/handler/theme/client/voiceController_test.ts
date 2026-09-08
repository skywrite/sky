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
  response?: { instructions?: string; tool_choice?: string }
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
  const sonnyAudio = audio()
  const session = {
    clientSecret: 'host-test-secret',
    model: 'gpt-realtime-2.1',
    voice: 'marin',
    opening: 'Greet the user.',
    instructions: 'You are Sky. Use she/her; Sonny uses he/him.',
    tools: ['lookup_notebook', 'research_notebook'],
    researcher: {
      clientSecret: 'sonny-test-secret',
      model: 'gpt-realtime-2.1',
      voice: 'ash',
      name: 'Sonny',
      instructions: 'You are Sonny. Report evidence in your own voice.',
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
    audio: (speaker) => (speaker === 'sky' ? hostAudio : sonnyAudio),
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
  return { controller, peers, requests, mic, timers, hostAudio, sonnyAudio, session }
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
function tool(peer: Peer, name: string, id: string, status = 'completed', itemStatus = 'completed', input?: unknown) {
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
          arguments: JSON.stringify(
            input === undefined ? (name === 'resume_research' ? {} : { question: 'What changed in Atlas?' }) : input,
          ),
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
          name: 'invite_sonny',
          call_id: `${id}-invite`,
          arguments: JSON.stringify(input),
        },
      ],
    },
  })
}

const TOGETHER_QUESTIONS = {
  web_question: 'Give a public overview of current heat-pump efficiency.',
  notebook_question: 'Compare the Atlas pilot requirements in the notebook with that public overview.',
}

test('voice joins the existing chat and accepts typed messages on the same speaking floor', async () => {
  const { controller, peers, mic } = harness()
  const context = 'Previous chat: User asked about the Atlas outline. Sky suggested a focused hour.'
  await controller.start(null, null, context)
  await settle()
  assert({
    given: 'a chat switching to voice',
    should: 'give both voices the same history before speaking',
    actual: peers.map((peer) => messages(peer).filter((event) => event.item?.content?.[0]?.text === context).length),
    expected: [1, 1],
  })
  done(peers[0], 'hello', 'I’m listening.')
  drain(peers[0], 'hello')
  const accepted = controller.sendText('Keep the outline to three sections.')
  assert({
    given: 'a typed message while voice is active',
    should: 'send it to the host, mirror it to Sonny, and keep it in the transcript',
    actual: {
      accepted,
      turn: controller.state.turns.at(-1)?.text,
      host: messages(peers[0]).some(
        (event) => event.item?.content?.[0]?.text === 'Keep the outline to three sections.',
      ),
      sonny: messages(peers[1]).some((event) =>
        event.item?.content?.[0]?.text?.includes('Keep the outline to three sections.'),
      ),
      replies: responses(peers[0]).length,
    },
    expected: { accepted: true, turn: 'Keep the outline to three sections.', host: true, sonny: true, replies: 2 },
  })
  controller.setMuted(true)
  assert({
    given: 'mute is pressed',
    should: 'disable the actual microphone track',
    actual: [controller.state.muted, mic.stream.getAudioTracks()[0].enabled],
    expected: [true, false],
  })
  controller.setMuted(false)
  assert({
    given: 'unmute is pressed',
    should: 'enable the actual microphone track',
    actual: [controller.state.muted, mic.stream.getAudioTracks()[0].enabled],
    expected: [false, true],
  })
  controller.end()
  assert({
    given: 'the chat stops voice',
    should: 'release the microphone and refuse further voice input',
    actual: [mic.stopped(), controller.sendText('After the call')],
    expected: [true, false],
  })
})
const TOGETHER_WEB = {
  status: 'complete',
  answer: 'Modern heat pumps transfer heat efficiently, with performance depending on temperature.',
  paths: [],
  urls: ['https://example.com/heat-pumps'],
}
const TOGETHER_NOTEBOOK = {
  status: 'complete',
  answer: 'Atlas requires cold-weather testing; the notebook records a proposed pilot, not a completed deployment.',
  paths: ['projects/open/Atlas/index.md'],
}

function together(peer: Peer, id: string, input: unknown = TOGETHER_QUESTIONS) {
  tool(peer, 'research_together', id, 'completed', 'completed', input)
}

function toolRequests(h: ReturnType<typeof harness>) {
  return h.requests
    .filter((request) => request.url.endsWith('/tools'))
    .map((request) => {
      const body = JSON.parse(request.init!.body as string) as { name: string; arguments: string }
      return { name: body.name, input: JSON.parse(body.arguments) as Record<string, unknown> }
    })
}

function researchResponse(report: unknown) {
  return Response.json({ output: JSON.stringify(report) })
}

function acknowledgeTogether(h: ReturnType<typeof harness>) {
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'sky-assignment', 'I’ll check the public numbers.')
  drain(host, 'sky-assignment')
  done(sonny, 'sonny-assignment', 'I’ll pull together the notebook side.')
  drain(sonny, 'sonny-assignment')
}

const EXCHANGE_STEPS = [
  {
    name: 'web overview',
    speaker: 0,
    instruction: 'Give your public web overview',
    transcript: 'Heat pumps transfer heat efficiently.',
  },
  {
    name: 'notebook comparison',
    speaker: 1,
    instruction: 'Give your notebook comparison',
    transcript: 'Atlas still needs cold-weather testing.',
  },
  {
    name: 'synthesis',
    speaker: 0,
    instruction: 'Bring your web findings',
    transcript: 'Atlas should validate winter performance before choosing a system.',
  },
] as const

for (const retrieval of ['pending', 'immediate'] as const) {
  test({ name: `joint research acknowledges both assignments before ${retrieval} results are presented` }, async () => {
    const web = deferred<Response>()
    const notebook = deferred<Response>()
    const h = harness({ lookup: web.promise, research: notebook.promise })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, 'Sky, check the public heat-pump numbers. Sonny, review our Atlas pilot notes.')
    together(host, 'joint')
    if (retrieval === 'immediate') {
      web.resolve(researchResponse(TOGETHER_WEB))
      notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
    }
    await settle()
    const skyRequest = responses(host).at(-1)?.response
    const skyContext = JSON.stringify(messages(host)) + skyRequest?.instructions
    assert({
      given: 'the user assigns separate research tasks to both speakers',
      should: 'start both searches immediately and let Sky acknowledge her own assignment before presenting evidence',
      actual: {
        requests: toolRequests(h).map((request) => request.name),
        replies: [responses(host).length, responses(sonny).length],
        running: h.controller.state.research.running,
        speaker: h.controller.state.speaker,
        persona: skyRequest?.instructions?.startsWith(h.session.instructions),
        assignment: skyContext.includes(TOGETHER_QUESTIONS.web_question),
        noFindings: !skyContext.includes(TOGETHER_WEB.answer) && !skyContext.includes(TOGETHER_NOTEBOOK.answer),
        toolChoice: skyRequest?.tool_choice,
      },
      expected: {
        requests: ['lookup_web', 'research_notebook'],
        replies: [3, 0],
        running: retrieval === 'pending' ? 2 : 0,
        speaker: 'sky',
        persona: true,
        assignment: true,
        noFindings: true,
        toolChoice: 'none',
      },
    })
    done(host, 'sky-assignment', 'I’ll check the public numbers.')
    assert({
      given: 'Sky has generated her acknowledgement but it is still playing',
      should: 'keep Sonny and the findings silent until her audio finishes',
      actual: [responses(host).length, responses(sonny).length, h.controller.state.speaker],
      expected: [3, 0, 'sky'],
    })
    drain(host, 'sky-assignment')
    const sonnyRequest = responses(sonny).at(-1)?.response
    const sonnyContext = JSON.stringify(messages(sonny)) + sonnyRequest?.instructions
    assert({
      given: 'Sky’s acknowledgement has finished playing',
      should: 'let Sonny acknowledge his notebook assignment in his own voice before either report',
      actual: {
        replies: [responses(host).length, responses(sonny).length],
        speaker: h.controller.state.speaker,
        persona: sonnyRequest?.instructions?.startsWith(h.session.researcher.instructions),
        assignment: sonnyContext.includes(TOGETHER_QUESTIONS.notebook_question),
        noFindings: !sonnyContext.includes(TOGETHER_WEB.answer) && !sonnyContext.includes(TOGETHER_NOTEBOOK.answer),
        toolChoice: sonnyRequest?.tool_choice,
        muted: [h.hostAudio.muted, h.sonnyAudio.muted],
      },
      expected: {
        replies: [3, 1],
        speaker: 'sonny',
        persona: true,
        assignment: true,
        noFindings: true,
        toolChoice: 'none',
        muted: [true, false],
      },
    })
    done(sonny, 'sonny-assignment', 'I’ll pull together the notebook side.')
    assert({
      given: 'Sonny’s acknowledgement is still playing',
      should: 'keep even immediately available findings from overtaking his audio',
      actual: [responses(host).length, responses(sonny).length],
      expected: [3, 1],
    })
    drain(sonny, 'sonny-assignment')
    if (retrieval === 'pending') {
      assert({
        given: 'both assignments were acknowledged before either search returned',
        should: 'return to listening while both searches continue',
        actual: [responses(host).length, responses(sonny).length, h.controller.state.activity],
        expected: [3, 1, 'listening'],
      })
      web.resolve(researchResponse(TOGETHER_WEB))
      notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
      await settle()
    }
    for (const [index, step] of EXCHANGE_STEPS.entries()) {
      const peer = h.peers[step.speaker]!
      done(peer, `findings-${index}`, step.transcript)
      drain(peer, `findings-${index}`)
    }
    assert({
      given: 'both acknowledgements and all findings have been heard',
      should: 'preserve the public overview, notebook comparison, and final synthesis without repeated retrieval',
      actual: {
        speakers: h.controller.state.turns.filter((turn) => turn.who !== 'you').map((turn) => turn.who),
        replies: [responses(host).length, responses(sonny).length],
        requests: toolRequests(h).length,
        research: h.controller.state.research,
      },
      expected: {
        speakers: ['sky', 'sonny', 'sky', 'sonny', 'sky'],
        replies: [5, 2],
        requests: 2,
        research: { running: 0, ready: 0, paused: 0 },
      },
    })
    h.controller.end()
  })
}

test(
  { name: 'joint research drops acknowledgements queued behind earlier audio when the user speaks again' },
  async () => {
    const web = deferred<Response>()
    const notebook = deferred<Response>()
    const h = harness({ lookup: web.promise, research: notebook.promise })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    host.channel.emit({ type: 'response.created', response: { id: 'joint' } })
    host.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
    host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'joint' })
    together(host, 'joint')
    assert({
      given: 'the tool-bearing response still has audio to drain',
      should: 'start both searches but keep the acknowledgements queued without advertising findings as ready',
      actual: [responses(host).length, responses(sonny).length, h.controller.state.research],
      expected: [2, 0, { running: 2, ready: 0, paused: 0 }],
    })
    user(host, 'Keep the research brief, please.')
    host.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'joint' })
    done(host, 'user-response', 'Sure, we’ll keep it brief.')
    drain(host, 'user-response')
    web.resolve(researchResponse(TOGETHER_WEB))
    notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
    await settle()
    assert({
      given: 'the user supersedes the queued acknowledgements and the searches then return',
      should: 'move straight to the web findings with no old acknowledgement or paused speech to resume',
      actual: {
        webOverview: responses(host).at(-1)?.response?.instructions?.includes(EXCHANGE_STEPS[0].instruction),
        replies: [responses(host).length, responses(sonny).length],
        paused: h.controller.state.research.paused,
        requests: toolRequests(h).length,
      },
      expected: { webOverview: true, replies: [4, 0], paused: 0, requests: 2 },
    })
    for (const [index, step] of EXCHANGE_STEPS.entries()) {
      const reportingPeer = h.peers[step.speaker]!
      done(reportingPeer, `findings-${index}`, step.transcript)
      drain(reportingPeer, `findings-${index}`)
    }
    assert({
      given: 'the source reports and conclusion complete after the skipped acknowledgements',
      should: 'leave only the user reply and useful findings in the spoken conversation',
      actual: h.controller.state.turns.filter((turn) => turn.who !== 'you').map((turn) => turn.text),
      expected: ['Sure, we’ll keep it brief.', ...EXCHANGE_STEPS.map((step) => step.transcript)],
    })
    h.controller.end()
  },
)

for (const speaker of ['sky', 'sonny'] as const) {
  test(
    { name: `joint research plays ${speaker}’s acknowledgement once when commentary repeats the final answer` },
    async () => {
      const web = deferred<Response>()
      const notebook = deferred<Response>()
      const h = harness({ lookup: web.promise, research: notebook.promise })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host)
      together(host, 'joint')
      if (speaker === 'sonny') {
        done(host, 'sky-assignment', 'I’ll check the public numbers.')
        drain(host, 'sky-assignment')
      }
      const peer = speaker === 'sky' ? host : sonny
      const other = speaker === 'sky' ? sonny : host
      const sink = speaker === 'sky' ? h.hostAudio : h.sonnyAudio
      const transcript = speaker === 'sky' ? 'I’ll check the public numbers.' : 'I’ll pull together the notebook side.'
      peer.channel.emit({ type: 'response.created', response: { id: 'assigned-ack' } })
      peer.channel.emit({
        type: 'response.output_item.added',
        response_id: 'assigned-ack',
        item: { id: 'ack-commentary', type: 'message', phase: 'commentary' },
      })
      peer.channel.emit({
        type: 'response.content_part.added',
        response_id: 'assigned-ack',
        item_id: 'ack-commentary',
        part: { type: 'audio' },
      })
      peer.channel.emit({ type: 'output_audio_buffer.started', response_id: 'assigned-ack' })
      peer.channel.emit({
        type: 'response.output_audio_transcript.done',
        response_id: 'assigned-ack',
        item_id: 'ack-commentary',
        transcript,
      })
      assert({
        given: 'the model emits an acknowledgement in commentary before its final answer',
        should: 'mute and omit the preliminary copy while retaining the speaking floor for the final acknowledgement',
        actual: {
          muted: sink.muted,
          displayed: h.controller.state.turns.some((turn) => turn.who === speaker && turn.text === transcript),
          mirrored: messages(other).some((event) => event.item?.content?.[0]?.text?.endsWith(transcript)),
          running: h.controller.state.research.running,
          speaker: h.controller.state.speaker,
        },
        expected: { muted: true, displayed: false, mirrored: false, running: 2, speaker },
      })
      peer.channel.emit({
        type: 'response.output_item.added',
        response_id: 'assigned-ack',
        item: { id: 'ack-final', type: 'message', phase: 'final_answer' },
      })
      peer.channel.emit({
        type: 'response.content_part.added',
        response_id: 'assigned-ack',
        item_id: 'ack-final',
        part: { type: 'audio' },
      })
      peer.channel.emit({
        type: 'response.output_audio_transcript.done',
        response_id: 'assigned-ack',
        item_id: 'ack-final',
        transcript,
      })
      peer.channel.emit({ type: 'response.done', response: { id: 'assigned-ack', status: 'completed', output: [] } })
      assert({
        given: 'the final acknowledgement repeats the preliminary wording in the same response',
        should: 'play and display one acknowledgement while holding the next speaker until playback finishes',
        actual: {
          muted: sink.muted,
          transcripts: h.controller.state.turns.filter((turn) => turn.who === speaker).map((turn) => turn.text),
          replies: [responses(host).length, responses(sonny).length],
          speaker: h.controller.state.speaker,
        },
        expected: { muted: false, transcripts: [transcript], replies: [3, speaker === 'sky' ? 0 : 1], speaker },
      })
      drain(peer, 'assigned-ack')
      assert({
        given: 'the scheduled acknowledgement has finished playing',
        should: 'share the spoken acknowledgement once and advance once without mislabelling it as research evidence',
        actual: {
          mirrored: messages(other).filter((event) => event.item?.content?.[0]?.text?.endsWith(transcript)).length,
          replies: [responses(host).length, responses(sonny).length],
          fakeEvidence: messages(host).some((event) =>
            event.item?.content?.[0]?.text?.includes('Reference evidence for the research Sonny just delivered'),
          ),
          paused: h.controller.state.research.paused,
        },
        expected: { mirrored: 1, replies: [3, 1], fakeEvidence: false, paused: 0 },
      })
      h.controller.end()
    },
  )

  test({ name: `joint research drops unfinished acknowledgements when ${speaker} is interrupted` }, async () => {
    const web = deferred<Response>()
    const notebook = deferred<Response>()
    const h = harness({ lookup: web.promise, research: notebook.promise })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    together(host, 'joint')
    if (speaker === 'sonny') {
      done(host, 'sky-assignment', 'I’ll check the public numbers.')
      drain(host, 'sky-assignment')
    }
    const peer = speaker === 'sky' ? host : sonny
    peer.channel.emit({ type: 'response.created', response: { id: 'interrupted-assignment' } })
    peer.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
    peer.channel.emit({ type: 'output_audio_buffer.started', response_id: 'interrupted-assignment' })
    peer.channel.emit({ type: 'response.output_audio_transcript.delta', delta: 'An unfinished acknowledgement' })
    user(host, 'Keep the research brief, please.')
    peer.channel.emit({ type: 'response.done', response: { id: 'interrupted-assignment', status: 'cancelled' } })
    peer.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'interrupted-assignment' })
    const afterInterruption = [responses(host).length, responses(sonny).length]
    h.controller.resumeResearch()
    assert({
      given: 'the user speaks over an assignment acknowledgement while both searches are running',
      should:
        'answer the user normally and discard pending acknowledgements without a resumable report or echoed fragment',
      actual: {
        replies: [responses(host).length, responses(sonny).length],
        research: h.controller.state.research,
        speaker: h.controller.state.speaker,
        ordinaryReply: responses(host).at(-1)?.response === undefined,
        echoed: [...messages(host), ...messages(sonny)].some((event) =>
          event.item?.content?.[0]?.text?.includes('An unfinished acknowledgement'),
        ),
        aborted: h.requests
          .filter((request) => request.url.endsWith('/tools'))
          .map((request) => request.init?.signal?.aborted),
      },
      expected: {
        replies: afterInterruption,
        research: { running: 2, ready: 0, paused: 0 },
        speaker: 'sky',
        ordinaryReply: true,
        echoed: false,
        aborted: [false, false],
      },
    })
    done(host, 'user-response', 'Sure, we’ll keep it brief.')
    drain(host, 'user-response')
    web.resolve(researchResponse(TOGETHER_WEB))
    notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
    await settle()
    assert({
      given: 'both searches finish after the interruption',
      should: 'present the web findings directly without restarting either acknowledgement',
      actual: [
        responses(host).at(-1)?.response?.instructions?.includes(EXCHANGE_STEPS[0].instruction),
        responses(sonny).length,
      ],
      expected: [true, afterInterruption[1]],
    })
    for (const [index, step] of EXCHANGE_STEPS.entries()) {
      const reportingPeer = h.peers[step.speaker]!
      done(reportingPeer, `findings-${index}`, step.transcript)
      drain(reportingPeer, `findings-${index}`)
    }
    assert({
      given: 'the retained research exchange completes',
      should: 'deliver only the three findings turns and keep no acknowledgement available to resume',
      actual: {
        addedReplies: [responses(host).length - afterInterruption[0]!, responses(sonny).length - afterInterruption[1]!],
        requests: toolRequests(h).length,
        research: h.controller.state.research,
        activity: h.controller.state.activity,
      },
      expected: {
        addedReplies: [2, 1],
        requests: 2,
        research: { running: 0, ready: 0, paused: 0 },
        activity: 'listening',
      },
    })
    h.controller.end()
  })
}

for (const speaker of ['sky', 'sonny'] as const) {
  for (const failure of ['silent', 'refused'] as const) {
    test({ name: `joint research continues after ${speaker} has a ${failure} acknowledgement` }, async () => {
      const h = harness({
        lookup: Promise.resolve(researchResponse(TOGETHER_WEB)),
        research: Promise.resolve(researchResponse(TOGETHER_NOTEBOOK)),
      })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host)
      together(host, 'joint')
      await settle()
      if (speaker === 'sonny') {
        done(host, 'sky-assignment', 'I’ll check the public numbers.')
        drain(host, 'sky-assignment')
      }
      const peer = speaker === 'sky' ? host : sonny
      if (failure === 'silent') done(peer, 'silent-assignment')
      else peer.channel.emit({ type: 'error', error: { message: 'The acknowledgement could not be created.' } })
      assert({
        given: `${speaker} cannot deliver an audible acknowledgement`,
        should: 'skip the failed acknowledgement without pausing the real findings',
        actual: [
          h.controller.state.research.paused,
          h.controller.state.speaker,
          responses(host).length,
          responses(sonny).length,
        ],
        expected: [0, speaker === 'sky' ? 'sonny' : 'sky', speaker === 'sky' ? 3 : 4, 1],
      })
      if (speaker === 'sky') {
        done(sonny, 'sonny-assignment', 'I’ll pull together the notebook side.')
        drain(sonny, 'sonny-assignment')
      }
      for (const [index, step] of EXCHANGE_STEPS.entries()) {
        const reportingPeer = h.peers[step.speaker]!
        done(reportingPeer, `findings-${index}`, step.transcript)
        drain(reportingPeer, `findings-${index}`)
      }
      assert({
        given: 'the remaining acknowledgement and findings finish',
        should: 'complete the exchange with no deadlock, retry, or extra retrieval',
        actual: [
          responses(host).length,
          responses(sonny).length,
          toolRequests(h).length,
          h.controller.state.research,
          h.controller.state.activity,
        ],
        expected: [5, 2, 2, { running: 0, ready: 0, paused: 0 }, 'listening'],
      })
      h.controller.end()
    })
  }
}

for (const first of ['web', 'notebook'] as const) {
  test(
    { name: `joint research preserves assigned speakers and audio order when ${first} retrieval finishes first` },
    async () => {
      const web = deferred<Response>()
      const notebook = deferred<Response>()
      const h = harness({ lookup: web.promise, research: notebook.promise })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host, 'Sky, check heat pumps on the web. Sonny, compare the Atlas notebook pilot.')
      together(host, 'joint')
      const dispatched = toolRequests(h)
      assert({
        given: 'one request assigning a public overview to Sky and an internal comparison to Sonny',
        should: 'start both retrievals before either resolves and keep private conversation out of the public query',
        actual: {
          requests: dispatched.map((request) => request.name),
          web: dispatched[0]?.input,
          notebookOnly: dispatched[1]?.input.notebook_only,
          notebookQuestion: String(dispatched[1]?.input.question).includes(TOGETHER_QUESTIONS.notebook_question),
          notebookConversation: String(dispatched[1]?.input.question).includes('[User] Sky, check heat pumps'),
          running: h.controller.state.research.running,
          replies: [responses(host).length, responses(sonny).length],
        },
        expected: {
          requests: ['lookup_web', 'research_notebook'],
          web: { question: TOGETHER_QUESTIONS.web_question },
          notebookOnly: true,
          notebookQuestion: true,
          notebookConversation: true,
          running: 2,
          replies: [3, 0],
        },
      })
      acknowledgeTogether(h)
      if (first === 'web') web.resolve(researchResponse(TOGETHER_WEB))
      else notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
      await settle()
      assert({
        given: `only ${first} retrieval has completed`,
        should:
          first === 'web'
            ? 'let Sky present promptly while notebook research continues'
            : 'hold Sonny until the public overview is available',
        actual: [responses(host).length, responses(sonny).length, h.controller.state.research.running],
        expected: [first === 'web' ? 4 : 3, 1, 1],
      })
      if (first === 'web') notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
      else web.resolve(researchResponse(TOGETHER_WEB))
      await settle()

      for (const [index, step] of EXCHANGE_STEPS.entries()) {
        const peer = h.peers[step.speaker]!
        const request = responses(peer).at(-1)?.response
        const persona = step.speaker === 0 ? h.session.instructions : h.session.researcher.instructions
        const beforeDrain = [responses(host).length, responses(sonny).length]
        assert({
          given: `the ${step.name} presentation is next`,
          should: 'keep the assigned persona, disable retrieval tools, and reserve one speaking floor',
          actual: [
            request?.instructions?.startsWith(persona),
            request?.instructions?.includes(step.instruction),
            request?.tool_choice,
            h.controller.state.speaker,
            h.hostAudio.muted,
            h.sonnyAudio.muted,
          ],
          expected: [true, true, 'none', step.speaker === 0 ? 'sky' : 'sonny', step.speaker !== 0, step.speaker !== 1],
        })
        done(peer, `presentation-${index}`, step.transcript)
        assert({
          given: `${step.name} generation is complete but its audio is still playing`,
          should: 'wait for audible playback to finish before starting the next speaker',
          actual: [responses(host).length, responses(sonny).length],
          expected: beforeDrain,
        })
        drain(peer, `presentation-${index}`)
      }
      const sonnyEvidenceIndex = sonny.channel.sent.findIndex((event) =>
        event.item?.content?.[0]?.text?.includes('Public web evidence already presented by Sky'),
      )
      const sonnyPresentationIndex = sonny.channel.sent.findIndex((event) =>
        event.response?.instructions?.includes('Give your notebook comparison'),
      )
      const sonnyEvidence = sonny.channel.sent[sonnyEvidenceIndex]?.item?.content?.[0]?.text ?? ''
      const synthesisEvidence =
        messages(host).find((event) => event.item?.content?.[0]?.text?.includes('"web":'))?.item?.content?.[0]?.text ??
        ''
      assert({
        given: 'all three assigned presentations have been heard',
        should:
          'share real source evidence before comparison, combine both results for Sky, and finish without another research call',
        actual: {
          publicBeforeSonny: sonnyEvidenceIndex >= 0 && sonnyEvidenceIndex < sonnyPresentationIndex,
          publicEvidence: sonnyEvidence.includes(TOGETHER_WEB.answer) && sonnyEvidence.includes(TOGETHER_WEB.urls[0]),
          synthesisEvidence:
            synthesisEvidence.includes(TOGETHER_WEB.answer) && synthesisEvidence.includes(TOGETHER_NOTEBOOK.answer),
          speakers: h.controller.state.turns.filter((turn) => turn.who !== 'you').map((turn) => turn.who),
          requests: toolRequests(h).length,
          replies: [responses(host).length, responses(sonny).length],
          research: h.controller.state.research,
          activity: h.controller.state.activity,
        },
        expected: {
          publicBeforeSonny: true,
          publicEvidence: true,
          synthesisEvidence: true,
          speakers: ['sky', 'sonny', 'sky', 'sonny', 'sky'],
          requests: 2,
          replies: [5, 2],
          research: { running: 0, ready: 0, paused: 0 },
          activity: 'listening',
        },
      })
      h.controller.end()
    },
  )
}

for (const [targetIndex, target] of EXCHANGE_STEPS.entries()) {
  for (const failure of ['interrupted', 'silent', 'refused'] as const) {
    test({ name: `joint research resumes the same ${target.name} after ${failure} delivery` }, async () => {
      const h = harness({
        lookup: Promise.resolve(researchResponse(TOGETHER_WEB)),
        research: Promise.resolve(researchResponse(TOGETHER_NOTEBOOK)),
      })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host, 'Sky, give the public overview. Sonny, compare the Atlas notebook.')
      together(host, 'joint')
      await settle()
      acknowledgeTogether(h)
      for (const [index, step] of EXCHANGE_STEPS.entries()) {
        if (index >= targetIndex) break
        const peer = h.peers[step.speaker]!
        done(peer, `earlier-${index}`, step.transcript)
        drain(peer, `earlier-${index}`)
      }
      const peer = h.peers[target.speaker]!
      const original = responses(peer).at(-1)?.response
      if (failure === 'interrupted') {
        peer.channel.emit({ type: 'response.created', response: { id: 'interrupted-presentation' } })
        peer.channel.emit({ type: 'output_audio_buffer.started', response_id: 'interrupted-presentation' })
        user(host, 'Pause there.')
        peer.channel.emit({ type: 'response.done', response: { id: 'interrupted-presentation', status: 'cancelled' } })
        peer.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'interrupted-presentation' })
        done(host, 'pause-acknowledgement')
      } else if (failure === 'silent') {
        done(peer, 'silent-presentation')
      } else {
        peer.channel.emit({ type: 'error', error: { message: 'The presentation could not be created.' } })
      }
      const paused = h.controller.state.research
      const beforeResume = [responses(host).length, responses(sonny).length]
      h.controller.resumeResearch()
      assert({
        given: `${target.name} was ${failure} before an audible presentation completed`,
        should: 'resume the exact saved speaker and instructions without advancing or repeating either retrieval',
        actual: {
          paused,
          request: responses(peer).at(-1)?.response,
          hostAdded: responses(host).length - beforeResume[0]!,
          sonnyAdded: responses(sonny).length - beforeResume[1]!,
          requests: toolRequests(h).length,
          speaker: h.controller.state.speaker,
          pausedAfterResume: h.controller.state.research.paused,
        },
        expected: {
          paused: { running: 0, ready: 0, paused: 1 },
          request: original,
          hostAdded: target.speaker === 0 ? 1 : 0,
          sonnyAdded: target.speaker === 1 ? 1 : 0,
          requests: 2,
          speaker: target.speaker === 0 ? 'sky' : 'sonny',
          pausedAfterResume: 0,
        },
      })
      for (const [index, step] of EXCHANGE_STEPS.entries()) {
        if (index < targetIndex) continue
        const remainingPeer = h.peers[step.speaker]!
        done(remainingPeer, `completed-${index}`, step.transcript)
        drain(remainingPeer, `completed-${index}`)
      }
      assert({
        given: 'the saved presentation and remaining phases finish after resume',
        should: 'finish the exchange once with no extra retrieval or undelivered phase',
        actual: [toolRequests(h).length, h.controller.state.research, h.controller.state.activity],
        expected: [2, { running: 0, ready: 0, paused: 0 }, 'listening'],
      })
      h.controller.end()
    })
  }
}

for (const targetIndex of [0, 2] as const) {
  test(
    { name: `joint research ignores unexpected tool calls in Sky’s ${EXCHANGE_STEPS[targetIndex].name}` },
    async () => {
      const h = harness({
        lookup: Promise.resolve(researchResponse(TOGETHER_WEB)),
        research: Promise.resolve(researchResponse(TOGETHER_NOTEBOOK)),
      })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host)
      together(host, 'joint')
      await settle()
      acknowledgeTogether(h)
      for (const [index, step] of EXCHANGE_STEPS.entries()) {
        if (index >= targetIndex) break
        const peer = h.peers[step.speaker]!
        done(peer, `earlier-${index}`, step.transcript)
        drain(peer, `earlier-${index}`)
      }
      host.channel.emit({ type: 'response.created', response: { id: 'presentation-with-tool' } })
      host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'presentation-with-tool' })
      host.channel.emit({
        type: 'response.output_audio_transcript.done',
        response_id: 'presentation-with-tool',
        transcript: EXCHANGE_STEPS[targetIndex].transcript,
      })
      host.channel.emit({
        type: 'response.done',
        response: {
          id: 'presentation-with-tool',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              status: 'completed',
              name: 'research_web',
              call_id: 'unexpected-research',
              arguments: JSON.stringify({ question: 'Start another public heat-pump investigation.' }),
            },
          ],
        },
      })
      await settle()
      const sonnyBeforeDrain = responses(sonny).length
      drain(host, 'presentation-with-tool')
      assert({
        given: 'a scheduled spoken presentation unexpectedly includes a completed research function call',
        should: 'ignore the function call, preserve audio ordering, and advance only the existing exchange',
        actual: {
          requests: toolRequests(h).map((request) => request.name),
          running: h.controller.state.research.running,
          paused: h.controller.state.research.paused,
          sonnyBeforeDrain,
          sonnyAfterDrain: responses(sonny).length,
          activity: h.controller.state.activity,
        },
        expected: {
          requests: ['lookup_web', 'research_notebook'],
          running: 0,
          paused: 0,
          sonnyBeforeDrain: targetIndex === 0 ? 1 : 2,
          sonnyAfterDrain: 2,
          activity: targetIndex === 0 ? 'speaking' : 'listening',
        },
      })
      h.controller.end()
    },
  )
}

for (const failed of ['web', 'notebook', 'both'] as const) {
  test({ name: `joint research preserves successful evidence when ${failed} retrieval fails` }, async () => {
    const webFailed = failed !== 'notebook'
    const notebookFailed = failed !== 'web'
    const web = webFailed
      ? { status: 'failed', answer: 'The public search could not retrieve a readable page.', paths: [] }
      : TOGETHER_WEB
    const notebook = notebookFailed
      ? { status: 'failed', answer: 'The notebook search service was unavailable.', paths: [] }
      : TOGETHER_NOTEBOOK
    const h = harness({
      lookup: Promise.resolve(researchResponse(web)),
      research: Promise.resolve(researchResponse(notebook)),
    })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    together(host, 'joint')
    await settle()
    acknowledgeTogether(h)
    done(
      host,
      'web-presentation',
      webFailed ? 'I could not verify the public sources.' : 'Heat pumps transfer heat efficiently.',
    )
    drain(host, 'web-presentation')
    const notebookInstructions = responses(sonny).at(-1)?.response?.instructions ?? ''
    const sonnyHasWebResult = messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes(web.answer))
    done(
      sonny,
      'notebook-presentation',
      notebookFailed ? 'I could not check the notebook comparison.' : 'Atlas still needs cold-weather testing.',
    )
    drain(sonny, 'notebook-presentation')
    const synthesis = responses(host).at(-1)?.response
    const hasSynthesis = synthesis?.instructions?.includes('Bring your web findings') ?? false
    assert({
      given: `${failed} retrieval failed in an otherwise coordinated conversation`,
      should:
        'report the source limit in its assigned voice, retain usable evidence, and omit synthesis only if both sources failed',
      actual: {
        sonnyHasWebResult,
        notebookDirection: notebookInstructions.includes(
          notebookFailed ? 'Your notebook investigation did not finish' : 'Give your notebook comparison',
        ),
        hasSynthesis,
        sourceLimit: !hasSynthesis || synthesis?.instructions?.includes('A failed source limits the comparison'),
        requests: toolRequests(h).length,
        replies: [responses(host).length, responses(sonny).length],
      },
      expected: {
        sonnyHasWebResult: true,
        notebookDirection: true,
        hasSynthesis: failed !== 'both',
        sourceLimit: true,
        requests: 2,
        replies: [failed === 'both' ? 4 : 5, 2],
      },
    })
    if (hasSynthesis) {
      const evidence =
        messages(host).find((event) => event.item?.content?.[0]?.text?.includes('"web":'))?.item?.content?.[0]?.text ??
        ''
      assert({
        given: 'one source still supports a useful closing observation',
        should: 'give Sky both the successful result and the exact failed-source limitation',
        actual: [evidence.includes(web.answer), evidence.includes(notebook.answer)],
        expected: [true, true],
      })
      done(host, 'qualified-synthesis', 'The remaining evidence supports a limited conclusion.')
      drain(host, 'qualified-synthesis')
    }
    assert({
      given: 'the available presentations have completed',
      should: 'release the conversation without a queued failed-source recap',
      actual: [h.controller.state.research, h.controller.state.activity],
      expected: [{ running: 0, ready: 0, paused: 0 }, 'listening'],
    })
    h.controller.end()
  })
}

test({ name: 'joint research rejects invalid assignment arguments without external tool requests' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  const invalid = [
    {},
    null,
    [],
    { ...TOGETHER_QUESTIONS, web_question: '' },
    { ...TOGETHER_QUESTIONS, web_question: '  ' },
    { ...TOGETHER_QUESTIONS, web_question: 'x'.repeat(12_001) },
    { ...TOGETHER_QUESTIONS, notebook_question: '' },
    { ...TOGETHER_QUESTIONS, notebook_question: 7 },
    { ...TOGETHER_QUESTIONS, notebook_question: 'x'.repeat(12_001) },
    { ...TOGETHER_QUESTIONS, private_query: 'Atlas' },
  ]
  for (const [index, input] of invalid.entries()) {
    user(host)
    together(host, `invalid-joint-${index}`, input)
    done(host, `explain-joint-${index}`)
  }
  assert({
    given: 'missing, blank, oversized, mistyped, non-object, or unexpected joint assignment fields',
    should: 'return local failures without starting retrieval or a research presentation',
    actual: {
      requests: toolRequests(h).length,
      failures: messages(host).filter(
        (event) =>
          event.item?.output?.startsWith('Research did not start:') ||
          event.item?.output?.startsWith('Tool failed: invalid JSON'),
      ).length,
      sonny: responses(sonny).length,
      research: h.controller.state.research,
    },
    expected: { requests: 0, failures: invalid.length, sonny: 0, research: { running: 0, ready: 0, paused: 0 } },
  })
  h.controller.end()
})

test({ name: 'joint research aborts both retrievals and drops late callbacks after End and restart' }, async () => {
  const web = deferred<Response>()
  const notebook = deferred<Response>()
  const h = harness({ lookup: web.promise, research: notebook.promise })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  together(host, 'joint')
  const pendingRequests = h.requests.filter((request) => request.url.endsWith('/tools'))
  h.controller.end()
  await h.controller.start()
  await settle()
  const [newHost, newSonny] = h.peers.slice(2) as [Peer, Peer]
  web.resolve(researchResponse(TOGETHER_WEB))
  notebook.resolve(researchResponse(TOGETHER_NOTEBOOK))
  done(host, 'stale-web', 'Stale public research.')
  drain(host, 'stale-web')
  done(sonny, 'stale-notebook', 'Stale notebook research.')
  drain(sonny, 'stale-notebook')
  await settle()
  assert({
    given: 'both research callbacks and old audio events arrive after a new call begins',
    should: 'abort both old requests and keep their evidence, queued phases, and speech out of the new session',
    actual: {
      aborted: pendingRequests.map((request) => request.init?.signal?.aborted),
      oldPeersClosed: host.connectionState === 'closed' && sonny.connectionState === 'closed',
      newMessages: [messages(newHost).length, messages(newSonny).length],
      newResponses: [responses(newHost).length, responses(newSonny).length],
      research: h.controller.state.research,
      turns: h.controller.state.turns,
      phase: h.controller.state.phase,
    },
    expected: {
      aborted: [true, true],
      oldPeersClosed: true,
      newMessages: [0, 0],
      newResponses: [1, 0],
      research: { running: 0, ready: 0, paused: 0 },
      turns: [],
      phase: 'live',
    },
  })
  h.controller.end()
})

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
      sonnyTracks: h.peers[1]!.tracks.length,
      sonnyReceive: h.peers[1]!.transceivers,
      hostResponses: responses(h.peers[0]!).length,
      sonnyResponses: responses(h.peers[1]!).length,
      phase: h.controller.state.phase,
      hostMuted: h.hostAudio.muted,
      sonnyMuted: h.sonnyAudio.muted,
    },
    expected: {
      peers: 2,
      hostTracks: 1,
      sonnyTracks: 0,
      sonnyReceive: [{ kind: 'audio', options: { direction: 'recvonly' } }],
      hostResponses: 1,
      sonnyResponses: 0,
      phase: 'live',
      hostMuted: false,
      sonnyMuted: true,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller mutes commentary without cancelling the lookup or its final answer' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
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
  const mirroredCommentary = messages(sonny).some((event) =>
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
      mirroredAnswer: messages(sonny).some((event) =>
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
    const [host, sonny] = h.peers as [Peer, Peer]
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
        mirrored: messages(sonny).at(-1)?.item?.content?.[0]?.text,
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
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, 'Sonny, say hello.')
    invite(host, 'invite')
    done(sonny, 'sonny-hello', 'Hey.')
    drain(sonny, 'sonny-hello')
    user(host, 'Sky, what is seven plus five?')
    host.channel.emit({ type: 'response.created', response: { id: 'host-answer' } })
    sonny.channel.emit({ type: 'response.created', response: { id: 'sonny-hello' } })
    sonny.channel.emit({
      type: 'response.output_item.added',
      response_id: 'sonny-hello',
      item: { id: 'late-sonny-final', type: 'message', phase: 'final_answer' },
    })
    sonny.channel.emit({
      type: 'response.content_part.added',
      response_id: 'sonny-hello',
      item_id: 'late-sonny-final',
      part: { type: 'audio' },
    })
    sonny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'sonny-hello' })
    assert({
      given: 'late final/audio events from Sonny while Sky is answering the next user turn',
      should: 'keep Sonny silent and preserve Sky’s speaking floor',
      actual: {
        hostMuted: h.hostAudio.muted,
        sonnyMuted: h.sonnyAudio.muted,
        speaker: h.controller.state.speaker,
      },
      expected: { hostMuted: false, sonnyMuted: true, speaker: 'sky' },
    })
    h.controller.end()
  },
)

test({ name: 'voice controller invites Sonny into conversation directly after Sky’s playback finishes' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Sonny, say hello.')
  host.channel.emit({ type: 'response.created', response: { id: 'invite' } })
  host.channel.emit({ type: 'response.content_part.added', part: { type: 'audio' } })
  host.channel.emit({ type: 'output_audio_buffer.started', response_id: 'invite' })
  host.channel.emit({ type: 'response.output_audio_transcript.done', transcript: 'Sure.' })
  invite(host, 'invite')
  const beforeDrain = responses(sonny).length
  drain(host, 'invite')
  const invited = {
    responses: responses(sonny).length,
    research: h.controller.state.research,
    hostResponses: responses(host).length,
    request: messages(sonny).some(
      (event) =>
        event.item?.content?.[0]?.text === 'Live conversational request addressed to Sonny:\nSay hello to the user.',
    ),
    context: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes('Sonny, say hello.')),
    instructions: responses(sonny).at(-1)?.response?.instructions?.includes('The invitation does not expand'),
  }
  done(sonny, 'hello', 'Hello! I’m Sonny.')
  const mirroredBeforeDrain = messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sonny'))
  drain(sonny, 'hello')
  assert({
    given: 'the user asks Sonny to say hello while Sky’s final audio is still playing',
    should:
      'yield directly to Sonny without research, mirror his delivered answer, and never generate an extra Sky handoff',
    actual: {
      beforeDrain,
      invited,
      mirroredBeforeDrain,
      mirroredAfterDrain: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sonny')),
      hostResponsesAfterSonny: responses(host).length,
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
      hostResponsesAfterSonny: 2,
      backendRequests: 0,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller gives Sonny quick web evidence before a same-batch invitation' }, async () => {
  const lookup = deferred<Response>()
  const h = harness({ lookup: lookup.promise })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Sonny, check the public status reference and explain it.')
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
          name: 'invite_sonny',
          call_id: 'answer-invitation',
          arguments: JSON.stringify({ request: 'Explain the status reference to the user.' }),
        },
      ],
    },
  })
  const beforeLookup = responses(sonny).length
  const evidence = 'Status 429 indicates rate limiting. Source: https://example.com/status/429'
  lookup.resolve(Response.json({ output: evidence }))
  await settle()
  const records = messages(sonny).map((event) => event.item?.content?.[0]?.text ?? '')
  const evidenceIndex = records.findIndex((text) => text.includes(evidence))
  const invitationIndex = records.findIndex((text) => text.startsWith('Live conversational request'))
  assert({
    given: 'a quick public lookup and invitation in the same host tool batch',
    should: 'supply the actual source result before Sonny answers, without another Sky reply or research job',
    actual: {
      beforeLookup,
      sonnyResponses: responses(sonny).length,
      evidenceBeforeRequest: evidenceIndex >= 0 && evidenceIndex < invitationIndex,
      hostResponses: responses(host).length,
      backendRequests: h.requests.filter((entry) => entry.url.endsWith('/tools')).length,
      research: h.controller.state.research,
    },
    expected: {
      beforeLookup: 0,
      sonnyResponses: 1,
      evidenceBeforeRequest: true,
      hostResponses: 2,
      backendRequests: 1,
      research: { running: 0, ready: 0, paused: 0 },
    },
  })
  h.controller.end()
})

test(
  { name: 'voice controller shares bounded task and mail evidence before Sonny gives a second opinion' },
  async () => {
    for (const name of ['search_email', 'google_email_read', 'google_email_inbox_view', 'day_items']) {
      const pending = deferred<Response>()
      const h = harness({ lookup: pending.promise })
      await h.controller.start()
      await settle()
      const [host, sonny] = h.peers as [Peer, Peer]
      done(host, 'greeting')
      user(host, 'I already sent the Atlas update. Check it and let Sonny weigh in.')
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
              name: 'invite_sonny',
              call_id: 'opinion',
              arguments: JSON.stringify({ request: 'Reassess the priorities using the current completion evidence.' }),
            },
          ],
        },
      })
      const beforeEvidence = responses(sonny).length
      pending.resolve(Response.json({ output: 'Verified Atlas completion evidence. ' + 'x'.repeat(30_000) }))
      await settle()
      const records = messages(sonny).map((event) => event.item?.content?.[0]?.text ?? '')
      const evidenceIndex = records.findIndex((text) => text.includes('Verified Atlas completion evidence.'))
      const invitationIndex = records.findIndex((text) => text.startsWith('Live conversational request'))
      const excerpt = records[evidenceIndex] ?? ''
      assert({
        given: `a ${name} result and a second-opinion invitation in the same tool batch`,
        should: 'share actual bounded evidence before Sonny speaks, preserving the fact that it is a partial excerpt',
        actual: [
          beforeEvidence,
          responses(sonny).length,
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
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'google_email_draft_new', 'draft')
  await settle()
  assert({
    given: 'a draft action result',
    should: 'exclude it from the read-only evidence feed',
    actual: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes('Draft action result.')),
    expected: false,
  })
  h.controller.end()
})

test({ name: 'voice controller drops a queued invitation when the user speaks again' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Let Sonny introduce himself.')
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
      sonnyResponses: responses(sonny).length,
      hostResponses: responses(host).length,
      research: h.controller.state.research,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { sonnyResponses: 0, hostResponses: 3, research: { running: 0, ready: 0, paused: 0 }, requests: 0 },
  })
  h.controller.end()
})

test({ name: 'voice controller keeps research queued when a conversational Sonny turn is interrupted' }, async () => {
  const research = deferred<Response>()
  const h = harness({ research: research.promise })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  user(host, 'Sonny, introduce yourself while the research runs.')
  invite(host, 'invite')
  done(sonny, 'hello', 'Hello! I’m here to help.')
  research.resolve(Response.json({ output: 'The Atlas note records two milestones.' }))
  await settle()
  user(host, 'Thanks, that is enough for the introduction.')
  const interrupted = { research: h.controller.state.research, muted: h.sonnyAudio.muted }
  sonny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'hello' })
  done(host, 'acknowledgement')
  assert({
    given: 'the user interrupts Sonny’s introduction while a research report is ready',
    should:
      'stop the introduction without creating a paused report, retain the actual research, and deliver it after the new turn',
    actual: {
      interrupted,
      sonnyResponses: responses(sonny).length,
      researchRequests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      report: messages(sonny).some((event) =>
        event.item?.content?.[0]?.text?.includes('The Atlas note records two milestones.'),
      ),
      mirroredUnheardHello: messages(host).some((event) =>
        event.item?.content?.[0]?.text?.includes('Hello! I’m here to help.'),
      ),
    },
    expected: {
      interrupted: { research: { running: 0, ready: 1, paused: 0 }, muted: true },
      sonnyResponses: 2,
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
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  const invalid = [
    { request: '' },
    { request: '   ' },
    { request: 'x'.repeat(12_001) },
    { request: 'Say hello.', extra: true },
  ]
  for (let i = 0; i < invalid.length; i++) {
    user(host, 'Invite Sonny.')
    invite(host, `invalid-${i}`, invalid[i])
    done(host, `explain-${i}`)
  }
  assert({
    given: 'empty, whitespace-only, oversized, or extra invitation arguments',
    should: 'return an honest local failure for Sky to explain without opening research or making Sonny speak',
    actual: {
      rejected: messages(host).filter((event) => event.item?.output?.startsWith('Sonny was not invited:')).length,
      sonnyResponses: responses(sonny).length,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      research: h.controller.state.research,
    },
    expected: { rejected: 4, sonnyResponses: 0, requests: 0, research: { running: 0, ready: 0, paused: 0 } },
  })
  h.controller.end()
})

test({ name: 'voice controller ignores an invitation from a tool batch superseded during a lookup' }, async () => {
  const lookup = deferred<Response>()
  const h = harness({ lookup: lookup.promise })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'Look that up and ask Sonny to explain.')
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
          name: 'invite_sonny',
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
      sonnyResponses: responses(sonny).length,
      cancelled: messages(host).some((event) =>
        event.item?.output?.includes('earlier invitation to Sonny was cancelled'),
      ),
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { sonnyResponses: 0, cancelled: true, requests: 1 },
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
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting', 'Hello.')
    drain(host, 'greeting')
    user(host)
    tool(host, 'research_notebook', 'research-request')
    const started = {
      hostResponses: responses(host).length,
      sonnyResponses: responses(sonny).length,
      running: h.controller.state.research.running,
      acknowledged: messages(host).some((event) => event.item?.output?.includes('Sonny is researching')),
    }
    user(host, 'While he looks, what is six times seven?')
    done(host, 'host-continues', 'Forty-two.')
    research.resolve(Response.json({ output: 'Atlas changed on 2026-01-12, according to the project note.' }))
    await settle()
    const waiting = {
      sonnyResponses: responses(sonny).length,
      ready: h.controller.state.research.ready,
      evidence: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Atlas changed')),
    }
    drain(host, 'host-continues')
    const reporting = {
      hostResponses: responses(host).length,
      sonnyResponses: responses(sonny).length,
      hostMuted: h.hostAudio.muted,
      sonnyMuted: h.sonnyAudio.muted,
    }
    done(sonny, 'sonny-report', 'The project note says Atlas changed on January twelfth.')
    const beforeDrain = messages(host).filter((event) =>
      event.item?.content?.[0]?.text?.includes('Speaker: Sonny'),
    ).length
    drain(sonny, 'sonny-report')
    assert({
      given: 'research completes while Sky still has buffered audio',
      should: 'yield until asked, wait for playback, then let Sonny report and share his evidence after delivery',
      actual: {
        started,
        waiting,
        reporting,
        beforeDrain,
        mirrored: messages(host).filter((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sonny')).length,
        evidenceAfterDelivery: messages(host).some((event) =>
          event.item?.content?.[0]?.text?.includes('Atlas changed on 2026-01-12'),
        ),
        userMirrored: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: User')),
        hostResponsesAfterReport: responses(host).length,
      },
      expected: {
        started: { hostResponses: 2, sonnyResponses: 0, running: 1, acknowledged: true },
        waiting: { sonnyResponses: 0, ready: 1, evidence: false },
        reporting: { hostResponses: 3, sonnyResponses: 1, hostMuted: true, sonnyMuted: false },
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

test({ name: 'voice controller gives Sonny ownership when quick and deep tools complete together' }, async () => {
  const research = deferred<Response>()
  const h = harness({
    research: research.promise,
    lookup: Promise.resolve(Response.json({ output: 'The Widget has a one-year warranty.' })),
  })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
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
  const waiting = { sky: responses(host).length, sonny: responses(sonny).length }
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
      'let Sonny give the supported comparison without another Sky answer or treating partial research as failure',
    actual: {
      waiting,
      sky: responses(host).length,
      sonny: responses(sonny).length,
      priorEvidence: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes('one-year warranty')),
      report: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      prematureSkyEvidence: messages(host).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      error: h.controller.state.error,
    },
    expected: {
      waiting: { sky: 2, sonny: 0 },
      sky: 2,
      sonny: 1,
      priorEvidence: true,
      report: true,
      prematureSkyEvidence: false,
      error: null,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller still answers independent tool results while Sonny researches' }, async () => {
  for (const name of ['day_items', 'google_email_draft_new', 'lookup_web']) {
    const research = deferred<Response>()
    const output =
      name === 'google_email_draft_new'
        ? JSON.stringify({ needsConfirmation: true, approvalId: 'draft-review', summary: 'Save a draft for Jane Doe.' })
        : 'The separate requested detail is available.'
    const h = harness({ research: research.promise, lookup: Promise.resolve(Response.json({ output })) })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, 'Have Sonny research Widget specifications and help with this separate request.')
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
        sonny: responses(sonny).length,
        running: h.controller.state.research.running,
        result: messages(host).some((event) => event.item?.output === output),
      },
      expected: { sky: 3, sonny: 0, running: 1, result: true },
    })
    h.controller.end()
    research.resolve(Response.json({ output: 'A late result after the call ended.' }))
    await settle()
  }
})

test({ name: 'voice controller retains research when Sonny completes without audible words' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  done(sonny, 'silent-report')
  const paused = h.controller.state.research.paused
  const evidence = messages(host).some((event) =>
    event.item?.content?.[0]?.text?.includes('research Sonny just delivered'),
  )
  h.controller.resumeResearch()
  assert({
    given: 'Sonny completes the presentation response without any audible transcript',
    should: 'keep the unheard report for resume and avoid telling Sky it was delivered',
    actual: { paused, evidence, presentations: responses(sonny).length },
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
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host, 'What is the Widget warranty?')
  tool(host, 'lookup_web', 'lookup')
  await settle()
  done(host, 'quick-answer')
  user(host, 'Now have Sonny investigate the alternatives.')
  tool(host, 'research_web', 'research')
  await settle()
  assert({
    given: 'a failed deeper search after a successful quick lookup',
    should: 'retain the successful evidence and deliver one distinct failure notice without a Sky fallback turn',
    actual: {
      priorEvidence: messages(sonny).some((event) =>
        event.item?.content?.[0]?.text?.includes('official Widget warranty'),
      ),
      failedAttempt: messages(sonny).some((event) =>
        event.item?.content?.[0]?.text?.startsWith('Research attempt did not finish. Status: failed.'),
      ),
      reports: messages(sonny).filter((event) =>
        event.item?.content?.[0]?.text?.startsWith('Research report to deliver'),
      ).length,
      sky: responses(host).length,
      sonny: responses(sonny).length,
      error: h.controller.state.error,
    },
    expected: {
      priorEvidence: true,
      failedAttempt: true,
      reports: 0,
      sky: 4,
      sonny: 1,
      error: 'Sonny’s research did not finish.',
    },
  })
  h.controller.end()
})

test({ name: 'voice controller sends public web research to Sonny without adding private conversation' }, async () => {
  const research = deferred<Response>()
  const h = harness({ research: research.promise })
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
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
  const beforeResult = responses(sonny).length
  const output = 'The publisher says version two adds export. Source: https://example.com/releases'
  research.resolve(Response.json({ output }))
  await settle()
  const request = h.requests.find((entry) => entry.url.endsWith('/tools'))!
  const body = JSON.parse(request.init!.body as string) as { name: string; arguments: string }
  assert({
    given: 'public web research after an unrelated private conversation',
    should: 'run in the background, preserve the public question, and deliver the cited result in Sonny’s voice',
    actual: {
      running,
      beforeResult,
      name: body.name,
      question: JSON.parse(body.arguments).question,
      sonnyResponses: responses(sonny).length,
      sourceDelivered: messages(sonny).some((event) => event.item?.content?.[0]?.text?.includes(output)),
      sourceAvailableToSky: messages(host).some((event) => event.item?.content?.[0]?.text?.includes(output)),
    },
    expected: {
      running: 1,
      beforeResult: 0,
      name: 'research_web',
      question,
      sonnyResponses: 1,
      sourceDelivered: true,
      sourceAvailableToSky: false,
    },
  })
  h.controller.end()
})

test({ name: 'voice controller gives user barge-in priority and retains the interrupted Sonny report' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  sonny.channel.emit({ type: 'response.created', response: { id: 'report' } })
  sonny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'report' })
  sonny.channel.emit({ type: 'response.output_audio_transcript.delta', delta: 'The findings are' })
  host.channel.emit({ type: 'input_audio_buffer.speech_started' })
  const interrupted = {
    muted: h.sonnyAudio.muted,
    cancelled: sonny.channel.sent.some((event) => event.type === 'response.cancel'),
    cleared: sonny.channel.sent.some((event) => event.type === 'output_audio_buffer.clear'),
    paused: h.controller.state.research.paused,
  }
  host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
  const beforeCommit = responses(host).length
  host.channel.emit({ type: 'input_audio_buffer.committed' })
  const beforeClear = responses(host).length
  sonny.channel.emit({ type: 'response.done', response: { id: 'report', status: 'cancelled' } })
  sonny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'report' })
  done(host, 'user-followup')
  const beforeResume = responses(sonny).length
  h.controller.resumeResearch()
  assert({
    given: 'the user interrupts a report and then finishes speaking',
    should:
      'silence Sonny immediately, wait for committed input and cleared audio, answer the user, and resume only when requested',
    actual: {
      interrupted,
      beforeCommit,
      beforeClear,
      afterClear: responses(host).length,
      beforeResume,
      afterResume: responses(sonny).length,
      interruptedTranscript: h.controller.state.turns.some((turn) => turn.who === 'sonny' && turn.interrupted),
      mirroredUnheard: messages(host).some((event) => event.item?.content?.[0]?.text?.includes('Speaker: Sonny')),
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

test({ name: 'voice controller resumes Sonny by spoken tool without another research request' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  sonny.channel.emit({ type: 'response.created', response: { id: 'report' } })
  sonny.channel.emit({ type: 'output_audio_buffer.started', response_id: 'report' })
  user(host, 'Pause there.')
  sonny.channel.emit({ type: 'response.done', response: { id: 'report', status: 'cancelled' } })
  sonny.channel.emit({ type: 'output_audio_buffer.cleared', response_id: 'report' })
  done(host, 'pause-ack')
  user(host, 'Sonny, continue your report.')
  const hostBeforeResume = responses(host).length
  tool(host, 'resume_research', 'resume')
  const extraHostReply = responses(host).length > hostBeforeResume
  const resumed = responses(sonny).length
  done(sonny, 'finished-report', 'The project has two milestones.')
  drain(sonny, 'finished-report')
  user(host, 'Continue.')
  tool(host, 'resume_research', 'nothing-waiting')
  assert({
    given: 'a paused report followed by a spoken request to continue, then another request after delivery',
    should: 'resume locally at the next pause and truthfully report when no paused report remains',
    actual: {
      extraHostReply,
      resumed,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
      acknowledged: messages(host).some((event) =>
        event.item?.output?.includes('saved research conversation will continue'),
      ),
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
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  user(host, 'Sonny, what did you find?')
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
      sonny: responses(sonny).length,
      requests: h.requests.filter((request) => request.url.endsWith('/tools')).length,
    },
    expected: { queued: 1, statusKnown: true, prematureEvidence: false, extraHostReply: false, sonny: 1, requests: 1 },
  })
  h.controller.end()
})

test({ name: 'voice controller retains Sonny’s report when response.create is refused' }, async () => {
  const h = harness()
  await h.controller.start()
  await settle()
  const [host, sonny] = h.peers as [Peer, Peer]
  done(host, 'greeting')
  user(host)
  tool(host, 'research_notebook', 'research')
  await settle()
  // The rejected request never receives response.created or response.done.
  sonny.channel.emit({ type: 'error', error: { message: 'The response could not be created.' } })
  const rejected = {
    paused: h.controller.state.research.paused,
    activity: h.controller.state.activity,
    error: h.controller.state.error,
    muted: h.sonnyAudio.muted,
  }
  user(host, 'Sonny, try that report again.')
  tool(host, 'resume_research', 'resume')
  done(host, 'resume-ack')
  assert({
    given: 'Sonny’s response.create is refused before generation starts',
    should: 'retain the undelivered report for a local retry and keep the rejection visible',
    actual: {
      rejected,
      responses: responses(sonny).length,
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
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host, `Earlier context ${'x'.repeat(15_000)}`)
    done(host, 'first-answer')
    user(host, 'Correction: the project is Atlas, not Widget.')
    tool(host, 'research_notebook', 'research')
    host.channel.emit({ type: 'input_audio_buffer.speech_started' })
    research.resolve(Response.json({ output: 'Atlas has two milestones.' }))
    await settle()
    const duringSpeech = responses(sonny).length
    host.channel.emit({ type: 'input_audio_buffer.speech_stopped' })
    const beforeCommit = responses(sonny).length
    host.channel.emit({ type: 'input_audio_buffer.committed' })
    const beforeAnswer = responses(sonny).length
    done(host, 'latest-answer', 'Yes, I heard your update.')
    drain(host, 'latest-answer')
    const request = JSON.parse(h.requests.find((item) => item.url.endsWith('/tools'))!.init!.body as string) as {
      arguments: string
    }
    const question = (JSON.parse(request.arguments) as { question: string }).question
    assert({
      given: 'a correction before research starts and another user turn while the report returns',
      should: 'send bounded conversation to Astra, let Sky answer first, and only then deliver Sonny’s report',
      actual: {
        duringSpeech,
        beforeCommit,
        beforeAnswer,
        afterAnswer: responses(sonny).length,
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
    const [host, sonny] = h.peers as [Peer, Peer]
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
    sonny.channel.emit({ type: 'response.output_audio_transcript.done', transcript: 'Stale response.' })
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
  { name: 'voice controller reports a research failure in Sonny’s voice and closes both calls when a peer fails' },
  async () => {
    const h = harness({
      research: Promise.resolve(Response.json({ message: 'Research service unavailable.' }, { status: 503 })),
    })
    await h.controller.start()
    await settle()
    const [host, sonny] = h.peers as [Peer, Peer]
    done(host, 'greeting')
    user(host)
    tool(host, 'research_notebook', 'research')
    await settle()
    const report = {
      called: responses(sonny).length,
      failure: messages(sonny).some((event) =>
        event.item?.content?.[0]?.text?.includes('Research service unavailable'),
      ),
      warning: h.controller.state.error !== null,
    }
    sonny.connectionState = 'failed'
    sonny.onconnectionstatechange?.()
    assert({
      given: 'research errors, followed by a failed Sonny connection',
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
