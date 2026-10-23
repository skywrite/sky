import type { VoiceChatRequest } from '../../../service/handler/voice/chatTools.ts'
import { LiveTranscript, type VoiceTurn } from './liveTranscript.ts'
/** One GPT-Live connection; speech and delegated Responses work have independent lifecycles. */
import { liveOffer, RemoteAudioLevel, type LiveAnswer, type SinkElement, type VoiceEvent } from './liveTransport.ts'

export type { SinkElement, VoiceEvent, VoiceTurn }
export type Speaker = 'sky'
export interface VoiceState {
  phase: 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'failed'
  muted: boolean
  activity: 'listening' | 'speaking' | 'checking'
  speaker: Speaker | null
  tool: string | null
  turns: VoiceTurn[]
  model: string | null
  voice: string | null
  tools: string[]
  processing: number
  error: string | null
}
export const INITIAL_VOICE_STATE: VoiceState = {
  phase: 'idle',
  muted: false,
  activity: 'listening',
  speaker: null,
  tool: null,
  turns: [],
  model: null,
  voice: null,
  tools: [],
  processing: 0,
  error: null,
}
export interface VoiceDependencies {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  createPeer: () => RTCPeerConnection
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  audio: (speaker: Speaker) => SinkElement | null
  warmSpeakers: (element: HTMLMediaElement) => Promise<void>
  setTimer: (callback: () => void, milliseconds: number) => number
  clearTimer: (timer: number) => void
}
interface ToolCall {
  callId: string
  output: Promise<{ output?: string; submitted?: boolean }>
}
interface ResponseWork {
  delegationId: string
  calls: ToolCall[]
  complete: boolean
  continuing: boolean
  failed: boolean
}
interface Call {
  id: string
  abort: AbortController
  toolsAbort: AbortController
  pc: RTCPeerConnection | null
  dc: RTCDataChannel | null
  mic: MediaStream | null
  output: string | null
  timers: Set<number>
  startupTimer?: number
  ready: boolean
  warm: boolean
  greeted: boolean
  heardSpeech: boolean
  endNotified: boolean
  opening: string
  closing: boolean
  ended?: Promise<void>
  resolveEnd?: () => void
  transcript: LiveTranscript
  responses: Map<string, ResponseWork>
  delegatedResponse: Map<string, string>
  pendingDelegations: Set<string>
  seenTools: Set<string>
  activeTools: Map<string, string>
  levels: RemoteAudioLevel
  speaking: boolean
  quietSamples: number
  serverTools: boolean
}

export function micConstraints(input: string | null): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(input ? { deviceId: { exact: input } } : {}),
    },
  }
}
export function describeVoiceError(err: unknown): string {
  const error = err as { name?: string; message?: string }
  if (error.name === 'NotAllowedError') return 'Microphone access was refused. Allow it for this site and try again.'
  if (error.name === 'NotFoundError') return 'No microphone was found.'
  return error.message ?? String(err)
}

export class VoiceController {
  state: VoiceState = INITIAL_VOICE_STATE
  private active: Call | null = null
  private generation = 0
  private serviceEnd: Promise<void> = Promise.resolve()

  constructor(
    private id: string,
    private deps: VoiceDependencies,
    private changed: (state: VoiceState) => void,
  ) {}

  private update(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }
  private current(call: Call): boolean {
    return this.active === call && !call.abort.signal.aborted
  }
  private later(call: Call, callback: () => void, ms: number): number {
    const timer = this.deps.setTimer(() => {
      call.timers.delete(timer)
      if (this.current(call)) callback()
    }, ms)
    call.timers.add(timer)
    return timer
  }
  private send(call: Call, event: Record<string, unknown>): boolean {
    if (!this.current(call) || !call.ready || call.dc?.readyState !== 'open') return false
    try {
      call.dc.send(JSON.stringify(event))
      return true
    } catch {
      this.fail(call, 'The voice connection could not send a result. Start a new call to reconnect.')
      return false
    }
  }
  private notifyEnd(call: Call): void {
    if (call.endNotified) return
    call.endNotified = true
    this.serviceEnd = this.deps.fetch(`/voice/${call.id}/end`, { method: 'POST', keepalive: true }).then(
      () => {},
      () => {},
    )
  }

  async start(
    input: string | null = null,
    output: string | null = null,
    context = '',
    chat?: VoiceChatRequest,
  ): Promise<void> {
    if (this.active) return
    const call: Call = {
      id: `${this.id}-${++this.generation}`,
      abort: new AbortController(),
      toolsAbort: new AbortController(),
      pc: null,
      dc: null,
      mic: null,
      output,
      timers: new Set(),
      ready: false,
      warm: false,
      greeted: false,
      heardSpeech: false,
      endNotified: false,
      opening: '',
      closing: false,
      transcript: new LiveTranscript(),
      responses: new Map(),
      delegatedResponse: new Map(),
      pendingDelegations: new Set(),
      seenTools: new Set(),
      activeTools: new Map(),
      levels: new RemoteAudioLevel(),
      speaking: false,
      quietSamples: 0,
      serverTools: false,
    }
    this.active = call
    this.update({ ...INITIAL_VOICE_STATE, phase: 'starting' })
    try {
      const mic = await this.deps.getUserMedia(micConstraints(input))
      if (!this.current(call)) {
        for (const track of mic.getTracks()) track.stop()
        return
      }
      call.mic = mic
      const track = mic.getAudioTracks()[0]
      if (!track) throw new Error('No microphone audio track was available.')
      const pc = this.deps.createPeer()
      const dc = pc.createDataChannel('oai-events')
      call.pc = pc
      call.dc = dc
      pc.addTrack(track, mic)
      call.startupTimer = this.later(call, () => this.fail(call, 'Voice took too long to connect. Try again.'), 45_000)
      pc.ontrack = (event) => {
        if (!this.current(call) || call.closing) return
        const el = this.deps.audio('sky')
        if (!el) {
          this.fail(call, 'The voice player is unavailable. Try again.')
          return
        }
        el.srcObject = event.streams[0] ?? new MediaStream([event.track])
        el.muted = false
        if (call.output && el.setSinkId) void el.setSinkId(call.output).catch(() => {})
        void this.deps.warmSpeakers(el).then(() => {
          if (!this.current(call)) return
          call.warm = true
          this.begin(call)
        })
        void el.play().catch(() => {
          if (this.current(call))
            this.fail(call, 'The browser blocked voice playback. Allow sound for this tab and try again.')
        })
      }
      pc.onconnectionstatechange = () => {
        if (!this.current(call)) return
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
          this.fail(call, 'Sky lost the audio connection. Start a new call to reconnect.')
      }
      dc.onmessage = ({ data }) => {
        if (!this.current(call)) return
        try {
          this.onEvent(call, JSON.parse(String(data)) as VoiceEvent)
        } catch {
          this.fail(call, 'The voice service sent an unreadable event. Start a new call to reconnect.')
        }
      }
      dc.onclose = () => {
        if (!this.current(call)) return
        if (call.closing) this.finish(call)
        else this.fail(call, 'The voice connection closed. Start a new call to reconnect.')
      }
      dc.onerror = () => {
        if (this.current(call)) this.fail(call, 'The voice event connection failed.')
      }
      dc.onopen = () => {
        this.later(
          call,
          () => {
            call.warm = true
            this.begin(call)
          },
          5000,
        )
        this.begin(call)
      }
      const sdp = await liveOffer(pc, call.abort.signal)
      const response = await this.deps.fetch(`/voice/${call.id}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, context, chat }),
        signal: call.abort.signal,
      })
      const session = (await response.json().catch(() => ({}))) as Partial<LiveAnswer>
      if (!this.current(call)) return
      if (!response.ok || !session.sdp || !session.sessionId || !session.opening)
        throw new Error(session.message ?? `The service could not connect voice (${response.status}).`)
      call.opening = session.opening
      call.serverTools = session.serverTools === true
      this.update({ model: session.model ?? null, voice: session.voice ?? null, tools: session.tools ?? [] })
      await pc.setRemoteDescription({ type: 'answer', sdp: session.sdp })
    } catch (error) {
      if (this.current(call)) this.fail(call, describeVoiceError(error))
    }
  }

  private begin(call: Call): void {
    if (!this.current(call) || call.closing || call.greeted || !call.ready || !call.warm || !call.opening) return
    if (call.dc?.readyState !== 'open') return
    call.greeted = true
    this.heartbeat(call)
    if (call.startupTimer !== undefined) {
      this.deps.clearTimer(call.startupTimer)
      call.timers.delete(call.startupTimer)
    }
    this.update({ phase: 'live' })
    if (!call.heardSpeech)
      this.send(call, { type: 'session.instructions.append', content: call.opening, delegation_id: null })
    void this.sampleAudio(call)
  }

  private async sampleAudio(call: Call): Promise<void> {
    if (!this.current(call) || call.closing || !call.pc) return
    try {
      const level = await call.levels.sample(call.pc, this.deps.audio('sky'))
      if (!this.current(call) || call.closing) return
      call.quietSamples = level > 0.008 ? 0 : call.quietSamples + 1
      const speaking = level > 0.008 || (call.speaking && call.quietSamples < 3)
      if (speaking !== call.speaking) {
        call.speaking = speaking
        this.activity(call)
      }
    } catch {
      /* Captions and tools continue if this browser omits audio statistics. */
    }
    if (this.current(call) && !call.closing) this.later(call, () => void this.sampleAudio(call), 150)
  }

  private heartbeat(call: Call): void {
    this.later(
      call,
      () => {
        if (call.closing) return
        void this.deps
          .fetch(`/voice/${call.id}/keepalive`, { method: 'POST', signal: call.abort.signal })
          .then((response) => {
            if (response.status === 410 && this.current(call))
              this.fail(call, 'The voice session expired. Start a new call.')
          })
          .catch(() => {})
        this.heartbeat(call)
      },
      30_000,
    )
  }

  private activity(call: Call): void {
    const processing = call.pendingDelegations.size
    this.update({
      processing,
      tool: call.activeTools.values().next().value ?? null,
      activity: call.speaking ? 'speaking' : processing ? 'checking' : 'listening',
      speaker: call.speaking ? 'sky' : null,
    })
  }

  private onEvent(call: Call, event: VoiceEvent): void {
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      if (event.delta) call.heardSpeech = true
      if (
        call.transcript.append(
          event.type === 'session.input_transcript.delta' ? 'you' : 'sky',
          event.delta ?? '',
          event.start_ms ?? NaN,
          event.end_ms ?? NaN,
          event.event_id,
        )
      )
        this.update({ turns: call.transcript.turns(!call.closing) })
      return
    }
    if (event.type === 'session.closed') {
      this.finish(call)
      return
    }
    if (call.closing) return
    switch (event.type) {
      case 'session.started':
        call.ready = true
        this.begin(call)
        break
      case 'session.delegation.created':
        if (event.delegation?.target === 'responses') {
          call.pendingDelegations.add(event.delegation.id)
          if (event.delegation.response_id)
            call.delegatedResponse.set(event.delegation.id, event.delegation.response_id)
          this.activity(call)
        }
        break
      case 'response.event':
        this.backendEvent(call, event)
        break
      case 'error':
        this.fail(call, event.error?.message ?? 'The voice service rejected a request. Try again.')
        break
    }
  }

  private backendEvent(call: Call, envelope: VoiceEvent): void {
    const event = envelope.event
    const delegationId = envelope.delegation_id
    if (!event || !delegationId) return
    const responseId = event.response?.id ?? event.response_id ?? call.delegatedResponse.get(delegationId)
    if (!responseId) return
    call.delegatedResponse.set(delegationId, responseId)
    let work = call.responses.get(responseId)
    if (!work) {
      work = { delegationId, calls: [], complete: false, continuing: false, failed: false }
      call.responses.set(responseId, work)
    }
    if (event.type === 'response.created') {
      call.pendingDelegations.add(delegationId)
      this.activity(call)
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const { call_id: callId, name, arguments: args } = event.item
      if (!callId || !name || call.seenTools.has(callId)) return
      call.seenTools.add(callId)
      work.calls.push({ callId, output: this.runTool(call, delegationId, callId, name, args ?? '{}') })
    }
    if (
      event.type === 'response.failed' ||
      event.type === 'response.incomplete' ||
      event.type === 'response.cancelled'
    ) {
      work.failed = true
      call.pendingDelegations.delete(delegationId)
      this.update({ error: event.response?.error?.message ?? 'The request could not finish. Ask Sky to try again.' })
      this.activity(call)
    }
    if (event.type === 'response.completed') {
      work.complete = true
      if (work.calls.length) void this.continueBackend(call, work)
      else {
        call.pendingDelegations.delete(delegationId)
        this.activity(call)
      }
    }
  }

  private async runTool(
    call: Call,
    delegationId: string,
    callId: string,
    name: string,
    args: string,
  ): Promise<{ output?: string; submitted?: boolean }> {
    call.activeTools.set(callId, name)
    this.activity(call)
    try {
      const response = await this.deps.fetch(`/voice/${call.id}/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args, delegationId, callId, turns: call.transcript.turns(true) }),
        signal: call.toolsAbort.signal,
      })
      const result = (await response.json()) as { output?: string; message?: string; submitted?: boolean }
      return result.submitted
        ? { submitted: true }
        : { output: result.output ?? `Tool failed: ${result.message ?? `service answered ${response.status}`}` }
    } catch (error) {
      return { output: `Tool failed: ${describeVoiceError(error)}` }
    } finally {
      call.activeTools.delete(callId)
      if (this.current(call) && !call.closing) this.activity(call)
    }
  }

  private async continueBackend(call: Call, work: ResponseWork): Promise<void> {
    if (!work.complete || work.continuing || work.failed) return
    work.continuing = true
    const results = await Promise.all(work.calls.map(async (item) => ({ callId: item.callId, ...(await item.output) })))
    if (!this.current(call) || call.closing || work.failed) return
    if (call.serverTools) {
      try {
        const response = await this.deps.fetch(`/voice/${call.id}/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: call.toolsAbort.signal,
          body: JSON.stringify({
            callIds: results.map((result) => result.callId),
            outputs: results.filter((result) => !result.submitted),
          }),
        })
        if (!response.ok) throw new Error('The voice tool connection could not continue. Start a new call.')
      } catch (error) {
        if (this.current(call) && !call.closing) this.fail(call, describeVoiceError(error))
      }
      return
    }
    for (const result of results) {
      const item = { type: 'function_call_output', call_id: result.callId, output: result.output }
      const event = { type: 'response.item.create', item }
      const limit = call.pc?.sctp?.maxMessageSize || 65_536
      if (new TextEncoder().encode(JSON.stringify(event)).length > limit)
        item.output = JSON.stringify({
          ok: false,
          error:
            'This result exceeds the voice connection’s message limit. Use a narrower query or a smaller source excerpt.',
        })
      if (!this.send(call, event)) return
    }
    // Appending outputs does not resume Live's managed Responses backend.
    // Complete every call in this response before requesting its continuation.
    this.send(call, { type: 'response.create' })
  }

  setMuted(muted: boolean): void {
    const call = this.active
    if (!call || call.closing) return
    for (const track of call.mic?.getAudioTracks() ?? []) track.enabled = !muted
    this.update({ muted })
  }
  async chooseInput(input: string | null): Promise<void> {
    const call = this.active
    if (!call || call.closing) return
    let stream: MediaStream | null = null
    try {
      stream = await this.deps.getUserMedia(micConstraints(input))
      if (!this.current(call) || call.closing) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      const sender = call.pc?.getSenders().find((item) => item.track?.kind === 'audio')
      const track = stream.getAudioTracks()[0]
      if (!sender || !track) throw new Error('The microphone connection is not ready.')
      track.enabled = !this.state.muted
      await sender.replaceTrack(track)
      if (!this.current(call) || call.closing) {
        for (const item of stream.getTracks()) item.stop()
        return
      }
      for (const old of call.mic?.getTracks() ?? []) old.stop()
      call.mic = stream
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop()
      if (this.current(call)) this.update({ error: describeVoiceError(error) })
    }
  }
  chooseOutput(output: string | null): void {
    if (this.active) this.active.output = output
    const el = this.deps.audio('sky')
    if (el?.setSinkId) void el.setSinkId(output ?? '').catch(() => {})
  }

  private release(call: Call): void {
    if (this.active === call) this.active = null
    call.abort.abort()
    call.toolsAbort.abort()
    for (const timer of call.timers) this.deps.clearTimer(timer)
    for (const track of call.mic?.getTracks() ?? []) track.stop()
    call.dc?.close()
    call.pc?.close()
    const el = this.deps.audio('sky')
    if (el) {
      el.pause()
      el.srcObject = null
    }
    this.notifyEnd(call)
    call.resolveEnd?.()
  }
  private finish(call: Call): void {
    this.release(call)
    this.update({
      phase: 'ended',
      activity: 'listening',
      speaker: null,
      tool: null,
      processing: 0,
      turns: call.transcript.turns(false),
    })
  }
  private fail(call: Call, error: string): void {
    if (call.closing) {
      this.finish(call)
      return
    }
    this.release(call)
    this.update({
      phase: 'failed',
      activity: 'listening',
      speaker: null,
      processing: 0,
      error,
      turns: call.transcript.turns(false),
    })
  }

  end(): Promise<void> {
    const call = this.active
    if (!call) return this.serviceEnd
    if (call.ended) return call.ended
    call.ended = new Promise((resolve) => {
      call.resolveEnd = () => {
        void this.serviceEnd.then(resolve)
      }
    })
    call.closing = true
    call.toolsAbort.abort()
    for (const track of call.mic?.getTracks() ?? []) track.stop()
    const el = this.deps.audio('sky')
    if (el) el.muted = true
    this.update({ phase: 'ending', processing: 0 })
    // Stop service actions immediately, but retain the event channel for final captions.
    this.notifyEnd(call)
    if (call.ready && call.dc?.readyState === 'open') {
      this.send(call, { type: 'session.close' })
      if (this.current(call)) this.later(call, () => this.finish(call), 3000)
    } else this.finish(call)
    return call.ended
  }
}
