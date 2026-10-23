/** Shared Live WebRTC transport details for calls and voice previews. */
export type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
export interface LiveAnswer {
  serverTools?: boolean
  sessionId: string
  sdp: string
  opening: string
  model?: string
  voice?: string
  tools?: string[]
  message?: string
}
export interface VoiceEvent {
  type: string
  event_id?: string
  delta?: string
  start_ms?: number
  end_ms?: number
  delegation_id?: string
  delegation?: { id: string; target: string; response_id?: string }
  event?: {
    type: string
    response_id?: string
    item?: { type: string; call_id?: string; name?: string; arguments?: string }
    response?: { id: string; status?: string; error?: { message?: string } }
  }
  error?: { code?: string | null; message?: string }
}

/** The Live session needs the gathered SDP, not the earlier candidate-free offer. */
export async function liveOffer(pc: RTCPeerConnection, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const offer = await pc.createOffer()
  signal.throwIfAborted()
  await pc.setLocalDescription(offer)
  signal.throwIfAborted()
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve, reject) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      const cleanup = () => {
        pc.removeEventListener('icegatheringstatechange', change)
        deadline.removeEventListener('abort', abort)
      }
      const change = () => {
        if (pc.iceGatheringState !== 'complete') return
        cleanup()
        resolve()
      }
      const abort = () => {
        cleanup()
        reject(new Error(signal.aborted ? 'Voice connection cancelled.' : 'Timed out connecting audio. Try again.'))
      }
      pc.addEventListener('icegatheringstatechange', change)
      deadline.addEventListener('abort', abort, { once: true })
      if (deadline.aborted) abort()
      else change()
    })
  }
  signal.throwIfAborted()
  const sdp = pc.localDescription?.sdp
  if (!sdp) throw new Error('The browser could not prepare an audio connection.')
  return sdp
}

/** Speech generation has no done event in Live. Sample received audio separately from transcripts. */
export class RemoteAudioLevel {
  private previous = new Map<string, { energy: number; duration: number }>()

  async sample(pc: RTCPeerConnection, audio: HTMLMediaElement | null): Promise<number> {
    if (!audio || audio.paused || audio.muted || audio.volume === 0) return 0
    const stats = await pc.getStats()
    let level = 0
    stats.forEach((stat) => {
      if (stat.type !== 'inbound-rtp' || (stat.kind ?? stat.mediaType) !== 'audio') return
      const prior = this.previous.get(stat.id)
      if (typeof stat.totalAudioEnergy === 'number' && typeof stat.totalSamplesDuration === 'number') {
        this.previous.set(stat.id, { energy: stat.totalAudioEnergy, duration: stat.totalSamplesDuration })
        if (prior && stat.totalSamplesDuration > prior.duration)
          level = Math.max(
            level,
            Math.sqrt(Math.max(0, stat.totalAudioEnergy - prior.energy) / (stat.totalSamplesDuration - prior.duration)),
          )
      }
      if (typeof stat.audioLevel === 'number') level = Math.max(level, stat.audioLevel)
    })
    return level
  }
}
