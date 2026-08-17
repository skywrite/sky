/**
 * VoiceSession — one live Realtime API conversation over a server
 * WebSocket: microphone up, speaker audio down, transcripts surfaced to
 * the host, and function calls executed locally between responses.
 *
 * Auth rides the SDK's WebSocket subprotocol scheme, which Bun's native
 * WebSocket supports, so no extra dependencies are involved. The model
 * handles slow tools natively — it keeps talking while one runs — so
 * execution here just answers the call and requests the follow-up
 * response, queueing that request if a response is already in flight.
 *
 * Audio comes through an injected engine. With the echo-cancelled duplex
 * engine the conversation is fully bidirectional; with the raw ffmpeg
 * fallback the mic is muted while the assistant speaks, because
 * otherwise the model hears its own voice as user speech, interrupts
 * itself, and answers its own echo — a feedback loop that shreds every
 * reply into fragments.
 */

import { setTimeout as delay } from 'node:timers/promises'
import OpenAI from 'openai'
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket'
import type { RealtimeFunctionTool, RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime'
import truncate from '#shared/strings/truncate.ts'
import { type AudioEngine, type EngineCallbacks, isExpectedExit, PCM_SAMPLE_RATE } from './audio.ts'

/** Mirrors ai:chat's tool-boundary clamp: an error must never carry megabytes. */
const MAX_TOOL_OUTPUT_ERROR_CHARS = 2000

/** How long a silent microphone can stay plausible before we warn. */
const MIC_WATCHDOG_MS = 8000

/**
 * The broken-capture failure mode streams (near-)zeros forever. A quirk:
 * the voice processor's noise suppression legitimately gates steady room
 * tone to zero once converged, so a low peak only means trouble if the
 * user has actually been speaking — hence the late, conditional wording.
 */
const SILENCE_PEAK_FLOOR = 50
const SILENCE_CHECK_MS = 20_000

/**
 * Echo-prone mode: keep the mic muted this long after the last audio
 * drains, covering the room's reverb tail so the model never hears the
 * end of its own sentence.
 */
const ECHO_TAIL_MS = 350

export interface VoiceSessionOptions {
  apiKey: string
  model: string
  voice: string
  instructions: string
  /** Spoken verbatim as the session's opening line. */
  greeting: string
  /** Realtime reasoning effort — omitted means the server default. */
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** Builds the audio engine around the session's capture callbacks. */
  createEngine: (callbacks: EngineCallbacks) => AudioEngine
  tools: RealtimeFunctionTool[]
  /** Executes one tool call; the returned string goes back to the model verbatim. */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>
  out: {
    user: (transcript: string) => void
    assistant: (transcript: string) => void
    status: (line: string) => void
    warn: (line: string) => void
  }
  /** The socket closed — session over, whatever the reason. */
  onClose: () => void
}

export class VoiceSession {
  private readonly socket: OpenAIRealtimeWebSocket
  private readonly engine: AudioEngine
  private engineStarted = false
  private stopped = false
  private responseActive = false
  private pendingResponseCreate = false
  /** True once session.created arrived — separates auth failures from mid-session drops. */
  everConnected = false
  /** Completed assistant utterances, for the exit summary. */
  assistantTurns = 0

  constructor(private readonly opts: VoiceSessionOptions) {
    this.socket = new OpenAIRealtimeWebSocket({ model: opts.model }, new OpenAI({ apiKey: opts.apiKey }))
    this.engine = opts.createEngine({
      onChunk: (audio) => {
        if (this.stopped) return
        // No echo canceller: dropping mic frames while the assistant is
        // audible is what prevents the self-interruption feedback loop.
        if (this.engine.echoProne && this.engine.playbackActive(ECHO_TAIL_MS)) return
        this.socket.send({ type: 'input_audio_buffer.append', audio })
      },
      onExit: (code, stderr) => {
        const detail = stderr.split('\n')[0] ?? ''
        if (isExpectedExit(code)) {
          this.opts.out.status('Audio engine stopped.')
        } else {
          this.opts.out.warn(`Audio engine exited (code ${code}). ${detail}`.trim())
        }
      },
    })
    this.wireEvents()
  }

  private wireEvents(): void {
    const { out } = this.opts

    this.socket.on('session.created', () => {
      this.everConnected = true
      this.socket.send({ type: 'session.update', session: this.sessionConfig() })
    })

    this.socket.on('session.updated', () => {
      if (this.engineStarted) return
      this.engineStarted = true
      this.engine.start()
      this.watchMic()
      out.status(
        this.engine.echoProne
          ? 'Listening — mic mutes while Sky speaks (no echo canceller); headphones give full duplex.'
          : 'Listening — echo-cancelled duplex audio; interrupt whenever you like.',
      )
      // The scripted greeting proves the whole audio path immediately.
      this.requestResponse(`Say exactly this, and nothing else: "${this.opts.greeting}"`)
    })

    this.socket.on('response.created', () => {
      this.responseActive = true
    })

    this.socket.on('response.output_audio.delta', (event) => {
      this.engine.playbackWrite(event.delta, event.item_id)
    })

    this.socket.on('response.output_audio_transcript.done', (event) => {
      this.assistantTurns += 1
      out.assistant(event.transcript)
    })

    this.socket.on('conversation.item.input_audio_transcription.completed', (event) => {
      out.user(event.transcript)
    })

    // Barge-in: silence local playback at once, then tell the server how
    // much of the utterance was actually heard so the transcript matches.
    this.socket.on('input_audio_buffer.speech_started', () => {
      const snapshot = this.engine.playbackInterrupt()
      if (snapshot?.stillPlaying) {
        this.socket.send({
          type: 'conversation.item.truncate',
          item_id: snapshot.itemId,
          content_index: 0,
          audio_end_ms: Math.floor(snapshot.playedMs),
        })
      }
    })

    this.socket.on('response.done', (event) => {
      this.responseActive = false
      const calls = (event.response.output ?? []).filter((item) => item.type === 'function_call')
      if (calls.length > 0) {
        void this.runToolCalls(
          calls.map((c) => ({ name: c.name ?? '', callId: c.call_id ?? '', argsJson: c.arguments ?? '{}' })),
        )
        return
      }
      if (this.pendingResponseCreate) {
        this.pendingResponseCreate = false
        this.requestResponse()
      }
    })

    this.socket.on('error', (error) => {
      out.warn(`Realtime error: ${error.message}`)
    })

    this.socket.socket.addEventListener('close', () => {
      if (!this.stopped) this.opts.onClose()
    })
  }

  private sessionConfig(): RealtimeSessionCreateRequest {
    const { model, voice, instructions, effort, tools } = this.opts
    return {
      type: 'realtime',
      model,
      output_modalities: ['audio'],
      instructions,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: PCM_SAMPLE_RATE },
          // Server-side noise filtering helps VAD regardless of engine.
          noise_reduction: { type: 'near_field' },
          transcription: { model: 'gpt-live-transcribe' },
          turn_detection: { type: 'semantic_vad' },
        },
        output: { format: { type: 'audio/pcm', rate: PCM_SAMPLE_RATE }, voice },
      },
      tools,
      tool_choice: 'auto',
      // Notebook content must not land in OpenAI's traces dashboard.
      tracing: null,
      ...(effort ? { reasoning: { effort } } : {}),
    }
  }

  /** Execute every function call from one response, then ask for the follow-up. */
  private async runToolCalls(calls: Array<{ name: string; callId: string; argsJson: string }>): Promise<void> {
    for (const call of calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.argsJson) as Record<string, unknown>
      } catch {
        // Malformed arguments — run the tool with none and let it complain.
      }
      let output: string
      try {
        output = await this.opts.executeTool(call.name, args)
      } catch (err) {
        // Failures cross this boundary as strings only, clamped — the
        // same rule ai:chat's tool runner enforces.
        output = truncate(`Tool failed: ${(err as Error).message}`, MAX_TOOL_OUTPUT_ERROR_CHARS)
      }
      if (this.stopped) return
      this.socket.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: call.callId, output },
      })
    }
    this.requestResponse()
  }

  /**
   * Ask the model to respond — deferred when a response is already in
   * flight (the model may narrate while a tool runs), since the API
   * rejects overlapping response.create calls.
   */
  private requestResponse(instructions?: string): void {
    if (this.stopped) return
    if (this.responseActive) {
      this.pendingResponseCreate = true
      return
    }
    this.socket.send({ type: 'response.create', ...(instructions ? { response: { instructions } } : {}) })
  }

  /**
   * Warn once if the mic produces nothing (almost always macOS
   * permissions) — or produces only zeros, which is a broken capture
   * path masquerading as a working one.
   */
  private watchMic(): void {
    void (async () => {
      await delay(MIC_WATCHDOG_MS)
      if (this.stopped) return
      if (this.engine.bytesRead === 0) {
        this.opts.out.warn(
          'No microphone data yet. If macOS just asked for permission, grant it and speak again; ' +
            'otherwise check System Settings → Privacy & Security → Microphone for your terminal, ' +
            'or pick an ffmpeg device with --mic (list: ffmpeg -f avfoundation -list_devices true -i "").',
        )
        return
      }
      await delay(SILENCE_CHECK_MS - MIC_WATCHDOG_MS)
      if (this.stopped) return
      if (this.engine.peakLevel < SILENCE_PEAK_FLOOR) {
        this.opts.out.warn(
          'The microphone has registered no sound at all so far. If you have been speaking and Sky is not ' +
            'responding, the capture path is broken — quit and retry with --mic 0 to force the raw ffmpeg path.',
        )
      }
    })()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.engine.stop()
    this.socket.close({ code: 1000, reason: 'session ended' })
  }
}
