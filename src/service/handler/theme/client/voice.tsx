/** Voice inside Chat: Sky hosts; Sonny returns from deeper research. */
import { ActionIcon, Button, Popover, Select, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { whenSpeakersWarm } from './speakers.ts'
import { humanize } from './toolLines.ts'
import { VoiceAudioLevels } from './voiceAudio.ts'
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
  const [audioMotion] = useState(
    () => new VoiceAudioLevels((speaker) => (speaker === 'sky' ? audioRef.current : sonnyAudioRef.current)),
  )
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

  const start = useCallback(
    async (context = '') => {
      await controller.start(chosen.input, chosen.output, context)
      if (controller.state.phase === 'live' || controller.state.phase === 'starting') void refreshDevices()
    },
    [controller, chosen, refreshDevices],
  )
  const end = useCallback(() => {
    controller.end()
    audioMotion.stop()
  }, [controller, audioMotion])
  const resumeResearch = useCallback(() => controller.resumeResearch(), [controller])
  const mute = useCallback(() => controller.setMuted(!controller.state.muted), [controller])
  const sendText = useCallback((text: string) => controller.sendText(text), [controller])
  const latest = useCallback(() => controller.state, [controller])

  useEffect(() => end, [end])
  useEffect(() => {
    if (state.phase === 'ended' || state.phase === 'failed') audioMotion.stop()
  }, [state.phase, audioMotion])
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

  return {
    state,
    audioMotion,
    audioRef,
    sonnyAudioRef,
    devices,
    chosen,
    start,
    end,
    resumeResearch,
    mute,
    sendText,
    latest,
    chooseInput,
    chooseOutput,
  }
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
      return state.activity === 'speaking'
        ? `${state.speaker === 'sonny' ? 'Sonny' : 'Sky'} is responding`
        : state.muted
          ? 'Microphone muted'
          : 'Listening'
  }
}

function deviceOptions(list: MediaDeviceInfo[], fallback: string) {
  return list.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
}

export function VoiceWave() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 9v6M8 5v14M12 2v20M16 6v12M20 9v6" />
    </svg>
  )
}

export function VoiceButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  const label = active ? 'End voice chat' : 'Start voice chat'
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant={active ? 'primary' : 'secondary'}
        className="sky-voice-toggle"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      >
        <VoiceWave />
      </ActionIcon>
    </Tooltip>
  )
}

/** Spoken replies use the same conversation column as typed replies. */
export function VoiceTranscript({ voice }: { voice: Voice }) {
  return (
    <>
      {voice.state.turns.map((turn, i) =>
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
    </>
  )
}

export function VoiceStatus({
  voice,
  syncing,
  error,
  onEnd,
  onRetry,
}: {
  voice: Voice
  syncing: boolean
  error: string | null
  onEnd: () => void
  onRetry: () => void
}) {
  const { state } = voice
  const inCall = state.phase === 'starting' || state.phase === 'live'
  if (!inCall && state.phase !== 'failed' && !syncing && !error) return null
  return (
    <div className="sky-voice-dock">
      <div className="sky-voice-bar" data-phase={error ? 'failed' : state.phase}>
        <span
          className="sky-voice-dot"
          data-activity={state.phase === 'live' && !state.muted ? state.activity : 'off'}
        />
        <span className="sky-voice-status" role="status">
          {error ?? (syncing ? 'Keeping the conversation…' : statusOf(state))}
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
        <div className="sky-voice-actions">
          {state.phase === 'live' && (
            <>
              <Tooltip label={state.muted ? 'Unmute microphone' : 'Mute microphone'} withArrow>
                <ActionIcon
                  size="sm"
                  aria-label={state.muted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-pressed={state.muted}
                  onClick={voice.mute}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="8" y="2" width="8" height="13" rx="4" />
                    <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />
                    {state.muted && <path d="m3 3 18 18" />}
                  </svg>
                </ActionIcon>
              </Tooltip>
              {voice.devices.inputs.length > 0 && (
                <Popover position="top-end" withArrow shadow="md" width={270}>
                  <Popover.Target>
                    <ActionIcon size="sm" aria-label="Voice devices">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M4 17h16" />
                        <circle cx="9" cy="7" r="3" fill="var(--sky-bg)" />
                        <circle cx="15" cy="17" r="3" fill="var(--sky-bg)" />
                      </svg>
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <div className="sky-voice-devices">
                      <Select
                        size="sm"
                        label="Microphone"
                        placeholder="System microphone"
                        data={deviceOptions(voice.devices.inputs, 'Microphone')}
                        value={voice.chosen.input}
                        onChange={(value) => void voice.chooseInput(value)}
                        clearable
                      />
                      {CAN_PICK_OUTPUT && voice.devices.outputs.length > 0 && (
                        <Select
                          size="sm"
                          label="Speaker"
                          placeholder="System speaker"
                          data={deviceOptions(voice.devices.outputs, 'Speaker')}
                          value={voice.chosen.output}
                          onChange={voice.chooseOutput}
                          clearable
                        />
                      )}
                    </div>
                  </Popover.Dropdown>
                </Popover>
              )}
            </>
          )}
          {error && (
            <Button size="xs" onClick={onRetry}>
              Retry
            </Button>
          )}
          {inCall && (
            <Button size="xs" variant="danger-quiet" onClick={onEnd}>
              End voice
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
