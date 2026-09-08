import type { Speaker } from './voiceController.ts'

interface VoiceAudioDependencies {
  createContext(): AudioContext
}

const SPEAKERS: Speaker[] = ['sky', 'sonny']

interface AudioBinding {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  samples: Float32Array<ArrayBuffer>
}

/**
 * Analysis taps remote streams without routing sound through Web Audio. HTML
 * audio retains playback, interruption muting, and the chosen output device.
 * Start within the call's user gesture; sample in the renderer's animation loop.
 */
export class VoiceAudioLevels {
  private context: AudioContext | null = null
  private starting: Promise<void> | null = null
  private lastTime: number | null = null
  private bindings: Partial<Record<Speaker, AudioBinding>> = {}
  private levels: Record<Speaker, number> = { sky: 0, sonny: 0 }
  private dependencies: VoiceAudioDependencies
  error: string | null = null

  constructor(
    private audio: (speaker: Speaker) => HTMLAudioElement | null,
    dependencies: Partial<VoiceAudioDependencies> = {},
  ) {
    this.dependencies = { createContext: () => new AudioContext(), ...dependencies }
  }

  /** Context creation/resume happens synchronously, before the first await. */
  start(): Promise<void> {
    try {
      if (this.error || this.context?.state === 'closed') this.stop()
      this.context ??= this.dependencies.createContext()
      const context = this.context
      this.error = null
      if (this.starting) return this.starting
      if (context.state === 'running') return Promise.resolve()
      const starting = context.resume().catch(() => {
        if (this.context === context) this.error = 'Voice animation is paused. Retry to resume.'
      })
      this.starting = starting
      void starting.then(() => {
        if (this.starting === starting) this.starting = null
      })
      return starting
    } catch {
      this.error = 'Voice animation is unavailable in this browser.'
      return Promise.resolve()
    }
  }

  /** The returned record is reused; reading audio never rerenders React. */
  sample(): Readonly<Record<Speaker, number>> {
    const context = this.context
    const time = context?.currentTime ?? 0
    const elapsed = this.lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, time - this.lastTime))
    this.lastTime = time
    for (const speaker of SPEAKERS) {
      const binding = this.bind(speaker)
      if (!binding || context?.state !== 'running' || !this.audible(speaker)) {
        this.levels[speaker] = 0
        continue
      }
      binding.analyser.getFloatTimeDomainData(binding.samples)
      let sum = 0
      for (const sample of binding.samples) sum += sample * sample
      const rms = Math.sqrt(sum / binding.samples.length)
      const target = Math.min(1, Math.max(0, (rms - 0.004) * 5)) * (this.audio(speaker)?.volume ?? 0)
      const previous = this.levels[speaker]
      const alpha = 1 - Math.exp(-elapsed / (target > previous ? 0.025 : 0.08))
      const level = previous + (target - previous) * alpha
      this.levels[speaker] = level < 0.001 ? 0 : level
    }
    return this.levels
  }

  stop(): void {
    const context = this.context
    this.context = null
    this.starting = null
    this.lastTime = null
    this.error = null
    for (const speaker of SPEAKERS) {
      this.levels[speaker] = 0
      this.unbind(speaker)
    }
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }

  private audible(speaker: Speaker): boolean {
    const element = this.audio(speaker)
    const stream = element?.srcObject
    return !!(
      element &&
      !element.muted &&
      !element.paused &&
      !element.ended &&
      element.volume > 0 &&
      stream &&
      'getAudioTracks' in stream &&
      stream.getAudioTracks().some((track) => track.enabled && !track.muted && track.readyState === 'live')
    )
  }

  private bind(speaker: Speaker): AudioBinding | undefined {
    const stream = this.audio(speaker)?.srcObject
    let binding = this.bindings[speaker]
    if (binding?.stream === stream) return binding
    this.unbind(speaker)
    this.levels[speaker] = 0
    if (!this.context || !stream || !('getAudioTracks' in stream) || !stream.getAudioTracks().length) return
    let source: MediaStreamAudioSourceNode | undefined
    let analyser: AnalyserNode | undefined
    try {
      source = this.context.createMediaStreamSource(stream)
      analyser = this.context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      binding = { stream, source, analyser, samples: new Float32Array(analyser.fftSize) }
      this.bindings[speaker] = binding
      return binding
    } catch {
      source?.disconnect()
      analyser?.disconnect()
      return
    }
  }

  private unbind(speaker: Speaker): void {
    this.bindings[speaker]?.source.disconnect()
    this.bindings[speaker]?.analyser.disconnect()
    delete this.bindings[speaker]
  }
}
