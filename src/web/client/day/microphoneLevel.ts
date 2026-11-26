/** Measures the same microphone track sent over WebRTC. The analyser has no playback connection. */
export class MicrophoneLevel {
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private analyser?: AnalyserNode
  private samples = new Float32Array(512)

  /** Resume on the mic tap so the meter can run on iOS after the permission prompt. */
  start(): void {
    try {
      this.context = new AudioContext()
      void this.context.resume().catch(() => {})
    } catch {
      // Dictation and its idle animation also work without Web Audio.
    }
  }

  connect(stream: MediaStream): void {
    if (!this.context) return
    try {
      this.source = this.context.createMediaStreamSource(stream)
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = this.samples.length
      this.source.connect(this.analyser)
    } catch {
      this.close()
    }
  }

  sample(): number {
    if (!this.analyser || this.context?.state !== 'running') return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let energy = 0
    for (const sample of this.samples) energy += sample * sample
    const rms = Math.sqrt(energy / this.samples.length)
    return Math.min(1, Math.sqrt(Math.max(0, rms - 0.008) * 7))
  }

  close(): void {
    this.source?.disconnect()
    this.analyser?.disconnect()
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {})
    this.source = undefined
    this.analyser = undefined
    this.context = undefined
  }
}
