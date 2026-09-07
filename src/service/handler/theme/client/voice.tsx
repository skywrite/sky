/** Talk: Sky hosts the conversation; Sonny returns from deeper research. */
import { Button, Select } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { humanize, useFollow } from './chat.tsx'
import { whenSpeakersWarm } from './speakers.ts'
import { INITIAL_VOICE_STATE, VoiceController, type SinkElement, type VoiceState } from './voiceController.ts'
import './voice.css'

export { CALLS_URL } from './voiceController.ts'
export type { VoiceState, VoiceTurn } from './voiceController.ts'

const DEVICES_KEY = 'sky-voice-devices'
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
    // Storage unavailable — use the system defaults.
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

const CAN_PICK_OUTPUT = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

export function useVoice(id: string) {
  const [state, setState] = useState<VoiceState>(INITIAL_VOICE_STATE)
  const audioRef = useRef<SinkElement | null>(null)
  const sonnyAudioRef = useRef<SinkElement | null>(null)
  const controllerRef = useRef<VoiceController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new VoiceController(
      id,
      {
        fetch: (...args) => fetch(...args),
        createPeer: () => new RTCPeerConnection(),
        getUserMedia: (constraints) => {
          if (!navigator.mediaDevices?.getUserMedia) {
            return Promise.reject(
              new Error('This page needs a secure context (https or localhost) to use the microphone.'),
            )
          }
          return navigator.mediaDevices.getUserMedia(constraints)
        },
        audio: (speaker) => (speaker === 'sky' ? audioRef.current : sonnyAudioRef.current),
        warmSpeakers: whenSpeakersWarm,
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (timer) => window.clearTimeout(timer),
      },
      setState,
    )
  }
  const controller = controllerRef.current
  const [chosen, setChosen] = useState<ChosenDevices>(loadDevices)
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  })

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    setDevices({
      inputs: all.filter((d) => d.kind === 'audioinput'),
      outputs: all.filter((d) => d.kind === 'audiooutput'),
    })
  }, [])

  const start = useCallback(async () => {
    await controller.start(chosen.input, chosen.output)
    if (controller.state.phase === 'live' || controller.state.phase === 'starting') void refreshDevices()
  }, [controller, chosen, refreshDevices])
  const end = useCallback(() => controller.end(), [controller])
  const resumeResearch = useCallback(() => controller.resumeResearch(), [controller])

  useEffect(() => () => controller.end(), [controller])
  useEffect(() => {
    if (state.phase !== 'live' || !navigator.mediaDevices?.addEventListener) return
    const onChange = () => void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [state.phase, refreshDevices])

  const chooseInput = useCallback(
    async (input: string | null) => {
      const next = { ...loadDevices(), input }
      setChosen(next)
      saveDevices(next)
      await controller.chooseInput(input)
    },
    [controller],
  )
  const chooseOutput = useCallback(
    (output: string | null) => {
      const next = { ...loadDevices(), output }
      setChosen(next)
      saveDevices(next)
      controller.chooseOutput(output)
    },
    [controller],
  )

  return { state, audioRef, sonnyAudioRef, devices, chosen, start, end, resumeResearch, chooseInput, chooseOutput }
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
        return state.tool === 'lookup_notebook'
          ? 'Checking the notebook…'
          : state.tool === 'lookup_web'
            ? 'Checking the web…'
            : `Running ${humanize(state.tool ?? 'a tool')}…`
      }
      return state.activity === 'speaking' ? `${state.speaker === 'sonny' ? 'Sonny' : 'Sky'} is speaking` : 'Listening'
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
            <Button size="sm" variant="danger-quiet" onClick={voice.end}>
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
              <p>Talk with Sky. Sonny joins in with deeper findings while you keep the conversation going.</p>
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
                <div key={i} className="sky-turn" data-voice={turn.who}>
                  <span className="sky-who">{turn.who}</span>
                  <div className="sky-body">
                    <p className="sky-para">
                      {turn.text}
                      {turn.live && <span className="sky-caret" aria-hidden="true" />}
                      {turn.interrupted && <span className="sky-voice-interrupted"> — interrupted</span>}
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
          <span className="sky-voice-status" role="status">
            {statusOf(state)}
          </span>
          {state.phase === 'live' && (state.research.running > 0 || state.research.ready > 0) && (
            <span className="sky-voice-research" role="status">
              {state.research.ready > 0 ? 'Research findings ready' : 'Researching…'}
            </span>
          )}
          {state.phase === 'live' && state.research.paused > 0 && (
            <Button size="xs" onClick={voice.resumeResearch}>
              Resume research
            </Button>
          )}
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
                {state.model} · Sky: {state.voice} · Sonny: {state.researcherVoice}
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
      <audio ref={voice.sonnyAudioRef} autoPlay />
    </div>
  )
}
