import { assert, test } from '#test'
import {
  auditionSessionConfig,
  openingInstructions,
  renderVoicePrompts,
  VOICE_GROUPS,
  VOICES,
  voiceSessionConfig,
} from './sessionConfig.ts'

const CLOCK = {
  notebookDate: '2026-01-27',
  notebookTime: '09:30',
  notebookTimezone: 'Europe/London',
  systemDate: '2026-01-27',
  systemTime: '09:30',
  systemTimezone: 'Europe/London',
}

const TOOL = { type: 'function' as const, name: 'ask_notebook', description: 'probe', parameters: { type: 'object' } }

test({ name: 'voice session config - a PCM transport declares its format, WebRTC declares none' }, () => {
  const spec = { model: 'gpt-realtime-2.1', voice: 'marin', instructions: 'Be Sky.', tools: [TOOL] }

  const socket = voiceSessionConfig({ ...spec, pcmRate: 24000 })
  assert({
    given: 'a 24 kHz PCM rate',
    should: 'declare it on both directions',
    actual: [socket.audio?.input?.format, socket.audio?.output?.format],
    expected: [
      { type: 'audio/pcm', rate: 24000 },
      { type: 'audio/pcm', rate: 24000 },
    ],
  })

  const webrtc = voiceSessionConfig(spec)
  assert({
    given: 'no rate',
    should: 'leave the format to the transport',
    actual: [webrtc.audio?.input?.format, webrtc.audio?.output?.format],
    expected: [undefined, undefined],
  })
  assert({
    given: 'either transport',
    should: 'keep the shared session shape',
    actual: {
      type: webrtc.type,
      model: webrtc.model,
      voice: webrtc.audio?.output?.voice,
      vad: webrtc.audio?.input?.turn_detection,
      transcription: webrtc.audio?.input?.transcription,
      tools: webrtc.tools,
      tracing: webrtc.tracing,
      reasoning: webrtc.reasoning,
    },
    expected: {
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      voice: 'marin',
      vad: { type: 'semantic_vad' },
      transcription: { model: 'gpt-live-transcribe' },
      tools: [TOOL],
      tracing: null,
      reasoning: undefined,
    },
  })
  assert({
    given: 'an effort',
    should: 'set it as the reasoning effort',
    actual: voiceSessionConfig({ ...spec, effort: 'low' }).reasoning,
    expected: { effort: 'low' },
  })
})

test({ name: 'voice session config - the groups cover every voice once, and an audition only speaks' }, () => {
  const grouped = [...VOICE_GROUPS.male, ...VOICE_GROUPS.female].toSorted()
  assert({
    given: 'the male and female groups',
    should: 'partition the voice list',
    actual: grouped,
    expected: [...VOICES].toSorted(),
  })
  const session = auditionSessionConfig('ash', 'Be Sky.')
  assert({
    given: 'an audition session',
    should: 'carry the voice and persona and nothing to listen with',
    actual: [session.audio?.output?.voice, session.instructions, session.tools, session.audio?.input, session.tracing],
    expected: ['ash', 'Be Sky.', undefined, undefined, null],
  })
})

test({ name: 'voice session config - the opening line carries the persona' }, () => {
  const opening = openingInstructions('You are Sky. Confident, composed.', 'Hey Jane, ready when you are.')
  assert({
    given: 'the session instructions and a greeting',
    should: 'put the persona first and quote the greeting verbatim',
    actual: [
      opening.startsWith('You are Sky. Confident, composed.'),
      opening.includes('## Opening line'),
      opening.endsWith('"Hey Jane, ready when you are."'),
    ],
    expected: [true, true, true],
  })
})

test({ name: 'voice session config - the prompts render with the clocks and a greeting' }, async () => {
  const prompts = await renderVoicePrompts(CLOCK, () => 0)
  assert({
    given: 'the session-start clocks',
    should: 'stamp both prompts with them',
    actual: [
      prompts.instructions.includes('2026-01-27 09:30 (Europe/London)'),
      prompts.askPrompt.includes('2026-01-27 09:30 (Europe/London)'),
    ],
    expected: [true, true],
  })
  assert({
    given: 'a fixed draw',
    should: 'open with hey and the first phrase',
    actual: prompts.greeting.startsWith('Hey') && prompts.greeting.endsWith(', what would you like to talk about?'),
    expected: true,
  })
})
