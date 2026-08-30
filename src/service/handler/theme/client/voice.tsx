/**
 * Talk — a voice session in the browser.
 *
 * The page connects to the Realtime API itself over WebRTC: the microphone
 * goes up as an audio track, Sky's voice comes back as one, and the
 * session's events ride a data channel. The service mints the secret the
 * page connects with and runs the tools the model calls; the page relays
 * each call and hands the output back. Echo cancellation, device routing,
 * and barge-in are the browser's and the server's — nothing here touches
 * a sample.
 */

import { Button, Select } from '@mantine/core'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { humanize, useFollow } from './chat.tsx'
import { whenSpeakersWarm } from './speakers.ts'
import './voice.css'

/** Where the SDP offer goes; the secret in the bearer carries the session. */
export const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
/** Whatever the speakers or session.created did, the greeting goes this long after the data channel opens. */
const GREETING_FALLBACK_MS = 5000
const DEVICES_KEY = 'sky-voice-devices'

export interface VoiceTurn {
  who: 'you' | 'sky'
  text: string
  /** Still being spoken — the text grows */
  live: boolean
}

type Phase = 'idle' | 'starting' | 'live' | 'ended' | 'failed'
type Activity = 'listening' | 'speaking' | 'checking'

export interface VoiceState {
  phase: Phase
  activity: Activity
  /** The tool running while checking */
  tool: string | null
  turns: VoiceTurn[]
  model: string | null
  voice: string | null
  tools: string[]
  /** The last thing that went wrong; fatal only when the phase says so */
  error: string | null
}

type Action =
  | { type: 'starting' }
  | { type: 'connected'; model: string | null; voice: string | null; tools: string[] }
  | { type: 'live' }
  | { type: 'activity'; activity: Activity; tool?: string }
  | { type: 'you'; text: string }
  | { type: 'sky-delta'; text: string }
  | { type: 'sky-done'; text: string }
  | { type: 'response-done' }
  | { type: 'warn'; error: string }
  | { type: 'ended' }
  | { type: 'failed'; error: string }

const INITIAL: VoiceState = {
  phase: 'idle',
  activity: 'listening',
  tool: null,
  turns: [],
  model: null,
  voice: null,
  tools: [],
  error: null,
}

/** Edit the live Sky bubble, opening one when none is live. */
function withLiveSky(turns: VoiceTurn[], edit: (turn: VoiceTurn) => VoiceTurn): VoiceTurn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    if (turn.who === 'sky' && turn.live) return turns.map((t, j) => (j === i ? edit(t) : t))
  }
  return [...turns, edit({ who: 'sky', text: '', live: true })]
}

function reduce(state: VoiceState, action: Action): VoiceState {
  switch (action.type) {
    case 'starting':
      return { ...INITIAL, phase: 'starting' }
    case 'connected':
      return { ...state, model: action.model, voice: action.voice, tools: action.tools }
    case 'live':
      return { ...state, phase: 'live' }
    case 'activity':
      return { ...state, activity: action.activity, tool: action.tool ?? null }
    case 'you': {
      // Transcription lands late: when Sky has already begun answering, the
      // question still reads before its answer.
      const last = state.turns.at(-1)
      const turn: VoiceTurn = { who: 'you', text: action.text, live: false }
      const turns =
        last && last.who === 'sky' && last.live ? [...state.turns.slice(0, -1), turn, last] : [...state.turns, turn]
      return { ...state, turns }
    }
    case 'sky-delta':
      return {
        ...state,
        activity: 'speaking',
        tool: null,
        turns: withLiveSky(state.turns, (t) => ({ ...t, text: t.text + action.text })),
      }
    case 'sky-done':
      return { ...state, turns: withLiveSky(state.turns, (t) => ({ ...t, text: action.text || t.text, live: false })) }
    case 'response-done':
      // A response that only called a tool spoke nothing: no empty bubble stays.
      return {
        ...state,
        activity: 'listening',
        tool: null,
        turns: state.turns.filter((t) => !(t.live && t.text === '')).map((t) => ({ ...t, live: false })),
      }
    case 'warn':
      return { ...state, error: action.error }
    case 'ended':
      return { ...state, phase: 'ended', turns: state.turns.map((t) => ({ ...t, live: false })) }
    case 'failed':
      return { ...state, phase: 'failed', error: action.error }
  }
}

/** The server events the page acts on; everything else passes by. */
interface RealtimeEvent {
  type: string
  delta?: string
  transcript?: string
  response?: { output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string }> }
  error?: { message?: string }
}

interface FunctionCall {
  name: string
  call_id: string
  arguments: string
}

interface SessionResponse {
  clientSecret: string
  expiresAt: number
  model: string | null
  voice: string | null
  opening: string
  tools: string[]
  message?: string
}

/** The live call — refs, not state: nothing here renders. */
interface Connection {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  mic: MediaStream
  opening: string
  /** A response is in flight — response.create would be refused */
  responseActive: boolean
  /** A response.create is owed once the current one finishes */
  pendingResponse: boolean
  /** session.created has arrived — the server will take a response.create */
  sessionReady: boolean
  /** The speakers have carried silence long enough for the route to settle */
  audioWarm: boolean
  greeted: boolean
  ended: boolean
}

interface ChosenDevices {
  input: string | null
  output: string | null
}

function loadDevices(): ChosenDevices {
  try {
    const raw = localStorage.getItem(DEVICES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChosenDevices>
      return { input: parsed.input ?? null, output: parsed.output ?? null }
    }
  } catch {
    // Storage unavailable or unreadable — the system defaults do.
  }
  return { input: null, output: null }
}

function saveDevices(chosen: ChosenDevices): void {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(chosen))
  } catch {
    // Not remembered, still used.
  }
}

function micConstraints(inputId: string | null): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(inputId ? { deviceId: { exact: inputId } } : {}),
    },
  }
}

function describeError(err: unknown): string {
  const error = err as { name?: string; message?: string }
  if (error.name === 'NotAllowedError') return 'Microphone access was refused. Allow it for this site and try again.'
  if (error.name === 'NotFoundError') return 'No microphone was found.'
  return error.message ?? String(err)
}

type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

const CAN_PICK_OUTPUT = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

export function useVoice(id: string) {
  const [state, dispatch] = useReducer(reduce, INITIAL)
  const connRef = useRef<Connection | null>(null)
  const audioRef = useRef<SinkElement | null>(null)
  const [chosen, setChosen] = useState<ChosenDevices>(loadDevices)
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  })

  const send = (conn: Connection, event: Record<string, unknown>) => {
    if (conn.ended || conn.dc.readyState !== 'open') return
    conn.dc.send(JSON.stringify(event))
  }

  // Deferred while a response is in flight: the model may narrate while a
  // tool runs, and the API refuses overlapping response.create calls.
  const requestResponse = (conn: Connection, instructions?: string) => {
    if (conn.responseActive) {
      conn.pendingResponse = true
      return
    }
    send(conn, { type: 'response.create', ...(instructions ? { response: { instructions } } : {}) })
  }

  // The scripted greeting proves the whole audio path; its instructions
  // carry the persona, since they replace the session's. It waits for
  // both the session and warm speakers, unless forced by the fallback.
  const greet = (conn: Connection, force = false) => {
    if (conn.greeted || conn.ended) return
    if (!force && !(conn.sessionReady && conn.audioWarm)) return
    conn.greeted = true
    requestResponse(conn, conn.opening)
  }

  const runToolCalls = async (conn: Connection, calls: FunctionCall[]) => {
    for (const call of calls) {
      dispatch({ type: 'activity', activity: 'checking', tool: call.name })
      let output: string
      try {
        const response = await fetch(`/voice/${id}/tools`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: call.name, arguments: call.arguments }),
        })
        const body = (await response.json().catch(() => ({}))) as { output?: string; message?: string }
        output =
          response.ok && typeof body.output === 'string'
            ? body.output
            : `Tool failed: ${body.message ?? `the service answered ${response.status}`}`
      } catch (err) {
        output = `Tool failed: ${(err as Error).message}`
      }
      if (conn.ended) return
      send(conn, {
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: call.call_id, output },
      })
    }
    dispatch({ type: 'activity', activity: 'listening' })
    requestResponse(conn)
  }

  const onEvent = (conn: Connection, event: RealtimeEvent) => {
    switch (event.type) {
      case 'session.created':
        dispatch({ type: 'live' })
        conn.sessionReady = true
        greet(conn)
        break
      case 'response.created':
        conn.responseActive = true
        break
      case 'response.output_audio_transcript.delta':
        dispatch({ type: 'sky-delta', text: event.delta ?? '' })
        break
      case 'response.output_audio_transcript.done':
        dispatch({ type: 'sky-done', text: (event.transcript ?? '').trim() })
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (event.transcript ?? '').trim()
        if (text) dispatch({ type: 'you', text })
        break
      }
      case 'input_audio_buffer.speech_started':
        // Barge-in: the server cancels the response and stops the audio.
        dispatch({ type: 'activity', activity: 'listening' })
        break
      case 'response.done': {
        conn.responseActive = false
        dispatch({ type: 'response-done' })
        const calls = (event.response?.output ?? [])
          .filter((item) => item.type === 'function_call')
          .map((item) => ({ name: item.name ?? '', call_id: item.call_id ?? '', arguments: item.arguments ?? '{}' }))
        if (calls.length > 0) void runToolCalls(conn, calls)
        else if (conn.pendingResponse) {
          conn.pendingResponse = false
          requestResponse(conn)
        }
        break
      }
      case 'error':
        dispatch({ type: 'warn', error: event.error?.message ?? 'Realtime error' })
        break
    }
  }

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    setDevices({
      inputs: all.filter((d) => d.kind === 'audioinput'),
      outputs: all.filter((d) => d.kind === 'audiooutput'),
    })
  }, [])

  const close = (conn: Connection) => {
    conn.ended = true
    try {
      conn.dc.close()
    } catch {
      // already closed
    }
    conn.pc.close()
    for (const track of conn.mic.getTracks()) track.stop()
    if (connRef.current === conn) connRef.current = null
    void fetch(`/voice/${id}/end`, { method: 'POST' }).catch(() => {})
  }

  const start = useCallback(async () => {
    if (connRef.current) return
    dispatch({ type: 'starting' })
    let mic: MediaStream | null = null
    const pc = new RTCPeerConnection()
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This page needs a secure context (https or localhost) to use the microphone.')
      }
      mic = await navigator.mediaDevices.getUserMedia(micConstraints(chosen.input))

      const opened = await fetch(`/voice/${id}/session`, { method: 'POST' })
      const session = (await opened.json().catch(() => ({}))) as Partial<SessionResponse>
      if (!opened.ok || !session.clientSecret || !session.opening) {
        throw new Error(session.message ?? `The service answered ${opened.status}.`)
      }
      dispatch({
        type: 'connected',
        model: session.model ?? null,
        voice: session.voice ?? null,
        tools: session.tools ?? [],
      })

      const conn: Connection = {
        pc,
        dc: pc.createDataChannel('oai-events'),
        mic,
        opening: session.opening,
        responseActive: false,
        pendingResponse: false,
        sessionReady: false,
        audioWarm: false,
        greeted: false,
        ended: false,
      }
      connRef.current = conn

      pc.ontrack = (event) => {
        const el = audioRef.current
        if (!el) return
        el.srcObject = event.streams[0] ?? null
        if (chosen.output && el.setSinkId) void el.setSinkId(chosen.output).catch(() => {})
        // Silence is already flowing on the track; the first word waits
        // for the speakers to be warm.
        void whenSpeakersWarm(el).then(() => {
          conn.audioWarm = true
          greet(conn)
        })
        void el.play().catch(() => {})
      }
      pc.addTrack(mic.getAudioTracks()[0]!, mic)
      pc.onconnectionstatechange = () => {
        if (conn.ended) return
        if (pc.connectionState === 'failed') {
          close(conn)
          dispatch({ type: 'failed', error: 'The connection failed.' })
        } else if (pc.connectionState === 'closed') {
          close(conn)
          dispatch({ type: 'ended' })
        }
      }
      conn.dc.onmessage = (message) => {
        try {
          onEvent(conn, JSON.parse(message.data as string) as RealtimeEvent)
        } catch {
          // Not an event.
        }
      }
      conn.dc.onopen = () => {
        window.setTimeout(() => greet(conn, true), GREETING_FALLBACK_MS)
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const answer = await fetch(CALLS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!answer.ok) throw new Error(`OpenAI refused the call (${answer.status}).`)
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
      void refreshDevices()
    } catch (err) {
      const conn = connRef.current
      if (conn) close(conn)
      else {
        if (mic) for (const track of mic.getTracks()) track.stop()
        pc.close()
      }
      dispatch({ type: 'failed', error: describeError(err) })
    }
  }, [id, chosen, refreshDevices])

  const end = useCallback(() => {
    const conn = connRef.current
    if (!conn) return
    close(conn)
    dispatch({ type: 'ended' })
  }, [])

  // Leaving the page ends the call; the service forgets the thread.
  useEffect(() => {
    return () => {
      const conn = connRef.current
      if (conn) close(conn)
    }
  }, [])

  // Headphones plugged in mid-call show up in the pickers.
  useEffect(() => {
    if (state.phase !== 'live' || !navigator.mediaDevices?.addEventListener) return
    const onChange = () => void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [state.phase, refreshDevices])

  const chooseInput = useCallback(async (input: string | null) => {
    const next = { ...loadDevices(), input }
    setChosen(next)
    saveDevices(next)
    const conn = connRef.current
    if (!conn) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(input))
      const track = stream.getAudioTracks()[0]!
      await conn.pc.getSenders()[0]?.replaceTrack(track)
      for (const old of conn.mic.getTracks()) old.stop()
      conn.mic = stream
    } catch (err) {
      dispatch({ type: 'warn', error: describeError(err) })
    }
  }, [])

  const chooseOutput = useCallback((output: string | null) => {
    const next = { ...loadDevices(), output }
    setChosen(next)
    saveDevices(next)
    const el = audioRef.current
    if (el?.setSinkId) void el.setSinkId(output ?? '').catch(() => {})
  }, [])

  return { state, audioRef, devices, chosen, start, end, chooseInput, chooseOutput }
}

export type Voice = ReturnType<typeof useVoice>

function statusOf(state: VoiceState): string {
  switch (state.phase) {
    case 'idle':
      return 'Not connected'
    case 'starting':
      return 'Connecting…'
    case 'ended':
      return 'Session over'
    case 'failed':
      return state.error ?? 'Something went wrong'
    case 'live':
      if (state.activity === 'checking') {
        return state.tool === 'ask_notebook' ? 'Checking the notebook…' : `Running ${humanize(state.tool ?? 'a tool')}…`
      }
      return state.activity === 'speaking' ? 'Sky is speaking' : 'Listening'
  }
}

function deviceOptions(list: MediaDeviceInfo[], fallback: string) {
  return list.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
}

/** A voice session as its own page. */
export function VoiceMain({ back }: { back: { label: string; onClick: () => void } }) {
  const [id] = useState(() => crypto.randomUUID())
  const voice = useVoice(id)
  const { state } = voice
  const scrollRef = useRef<HTMLDivElement>(null)
  useFollow(scrollRef, [state.turns, state.activity])
  const inCall = state.phase === 'starting' || state.phase === 'live'

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">Talk</span>
        <nav className="sky-tabs">
          {inCall ? (
            <Button size="sm" color="red" onClick={voice.end}>
              End
            </Button>
          ) : state.phase !== 'idle' ? (
            <Button size="sm" onClick={() => void voice.start()}>
              Talk again
            </Button>
          ) : null}
        </nav>
      </header>

      <div className="sky-scroll" ref={scrollRef}>
        {state.phase === 'idle' ? (
          <div className="sky-blank">
            <div className="sky-voice-hello">
              <p>Talk to your notebook. Sky answers by voice and checks your files as you go.</p>
              <Button size="md" onClick={() => void voice.start()}>
                Start talking
              </Button>
            </div>
          </div>
        ) : (
          <div className="sky-col">
            {state.turns.map((turn, i) =>
              turn.who === 'you' ? (
                <div key={i} className="sky-turn sky-turn-user">
                  <div className="sky-bubble">{turn.text}</div>
                </div>
              ) : (
                <div key={i} className="sky-turn">
                  <span className="sky-who">sky</span>
                  <div className="sky-body">
                    <p className="sky-para">
                      {turn.text}
                      {turn.live && <span className="sky-caret" aria-hidden="true" />}
                    </p>
                  </div>
                </div>
              ),
            )}
            {state.phase === 'starting' && <div className="sky-condensed">— connecting —</div>}
            {state.phase === 'ended' && <div className="sky-condensed">— session over —</div>}
            {state.phase === 'failed' && (
              <div className="sky-condensed" data-tone="failed">
                — {state.error} —
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sky-composer-zone">
        <div className="sky-voice-bar" data-phase={state.phase}>
          <span className="sky-voice-dot" data-activity={state.phase === 'live' ? state.activity : 'off'} />
          <span className="sky-voice-status">{statusOf(state)}</span>
          {state.phase === 'live' && state.error && <span className="sky-voice-warn">{state.error}</span>}
          {state.phase === 'live' && voice.devices.inputs.length > 0 && (
            <div className="sky-voice-devices">
              <Select
                size="xs"
                aria-label="Microphone"
                placeholder="System microphone"
                data={deviceOptions(voice.devices.inputs, 'Microphone')}
                value={voice.chosen.input}
                onChange={(value) => void voice.chooseInput(value)}
                clearable
              />
              {CAN_PICK_OUTPUT && voice.devices.outputs.length > 0 && (
                <Select
                  size="xs"
                  aria-label="Speaker"
                  placeholder="System speaker"
                  data={deviceOptions(voice.devices.outputs, 'Speaker')}
                  value={voice.chosen.output}
                  onChange={voice.chooseOutput}
                  clearable
                />
              )}
            </div>
          )}
        </div>
        <div className="sky-under">
          {state.model ? (
            <>
              <span className="sky-hint">
                {state.model} · voice {state.voice}
              </span>
              {state.tools.length > 0 && (
                <>
                  <span className="sky-hint">·</span>
                  <span className="sky-hint">tools: {state.tools.map(humanize).join(', ')}</span>
                </>
              )}
            </>
          ) : (
            <span className="sky-hint">Your microphone goes straight to OpenAI; the service only runs the tools.</span>
          )}
        </div>
      </div>
      <audio ref={voice.audioRef} autoPlay />
    </div>
  )
}
