import { liveOffer, RemoteAudioLevel, type LiveAnswer, type VoiceEvent } from './liveTransport.ts'
import { whenSpeakersWarm } from './speakers.ts'

interface PreviewOptions {
  voice: string
  passage?: string
  audio: HTMLAudioElement
  onSpeaking?: () => void
  onTranscript?: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}

/** A microphone-free GPT-Live preview, shared by Settings and the audition page. */
export function playVoicePreview(options: PreviewOptions): { stop: () => void } {
  const pc = new RTCPeerConnection()
  const dc = pc.createDataChannel('oai-events')
  // Live advances with input audio, even for a spoken preview. A generated silent
  // track keeps its timeline running without accessing the person's microphone.
  const silence = new AudioContext()
  const source = silence.createConstantSource()
  const input = silence.createMediaStreamDestination()
  source.offset.value = 0
  source.connect(input)
  source.start()
  for (const track of input.stream.getAudioTracks()) pc.addTrack(track, input.stream)
  const abort = new AbortController()
  const levels = new RemoteAudioLevel()
  const timers = new Set<number>()
  let ready = false
  let warm = false
  let asked = false
  let stopped = false
  let cleaned = false
  let opening = ''
  let transcript = ''
  let heardAudio = false
  let lastActivity = 0
  let output: MediaStream | null = null
  let closeTimer: number | undefined
  const later = (callback: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      if (!stopped) callback()
    }, ms)
    timers.add(timer)
    return timer
  }
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    source.stop()
    for (const track of input.stream.getTracks()) track.stop()
    void silence.close().catch(() => {})
    dc.close()
    pc.close()
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    abort.abort()
    for (const timer of timers) window.clearTimeout(timer)
    if (options.audio.srcObject === output) {
      options.audio.pause()
      options.audio.srcObject = null
    }
    if (ready && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify({ type: 'session.close' }))
        closeTimer = window.setTimeout(cleanup, 3000)
      } catch {
        cleanup()
      }
    } else cleanup()
  }
  const finish = () => {
    stop()
    options.onEnd()
  }
  const fail = (message: string) => {
    if (stopped) return
    options.onError(message)
    finish()
  }
  const sample = async () => {
    if (stopped) return
    try {
      const level = await levels.sample(pc, options.audio)
      if (stopped) return
      if (level > 0.008) {
        if (!heardAudio) options.onSpeaking?.()
        heardAudio = true
        lastActivity = performance.now()
      }
      // Live has no per-utterance audio-done event. A preview is one passage;
      // finish only after both received audio and captions have gone quiet.
      if (heardAudio && transcript && performance.now() - lastActivity > 2000) {
        finish()
        return
      }
    } catch {
      /* The timeout below reports a preview that cannot finish. */
    }
    later(() => void sample(), 150)
  }
  const begin = () => {
    if (stopped || asked || !ready || !warm || !opening || dc.readyState !== 'open') return
    asked = true
    try {
      dc.send(JSON.stringify({ type: 'session.instructions.append', content: opening, delegation_id: null }))
    } catch {
      fail('The voice preview disconnected. Try again.')
      return
    }
    void sample()
    later(() => fail('The voice preview did not finish. Try it again.'), 120_000)
  }
  dc.onopen = () => {
    later(() => {
      warm = true
      begin()
    }, 5000)
    begin()
  }
  dc.onmessage = ({ data }) => {
    let event: VoiceEvent
    try {
      event = JSON.parse(String(data)) as VoiceEvent
    } catch {
      fail('The preview received an unreadable event.')
      return
    }
    if (event.type === 'session.closed') {
      if (!stopped) finish()
      cleanup()
      return
    }
    if (stopped) return
    if (event.type === 'session.started') {
      ready = true
      begin()
    }
    if (event.type === 'session.output_transcript.delta') {
      transcript += event.delta ?? ''
      lastActivity = performance.now()
      options.onTranscript?.(transcript)
    }
    if (event.type === 'error') fail(event.error?.message ?? 'The voice preview failed.')
  }
  dc.onclose = () => {
    if (!stopped) fail('The voice preview disconnected. Try again.')
  }
  dc.onerror = () => fail('The voice preview connection failed.')
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') fail('The audio connection failed.')
  }
  pc.ontrack = (event) => {
    if (stopped) return
    output = event.streams[0] ?? new MediaStream([event.track])
    options.audio.srcObject = output
    options.audio.muted = false
    void whenSpeakersWarm(options.audio).then(() => {
      warm = true
      begin()
    })
    void options.audio.play().catch(() => fail('Allow sound for this tab to hear the preview.'))
  }
  later(() => {
    if (!asked) fail('The voice preview took too long to connect. Try again.')
  }, 45_000)
  void (async () => {
    try {
      await silence.resume()
      if (stopped) return
      const sdp = await liveOffer(pc, abort.signal)
      const response = await fetch('/voice/_api/audition/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: options.voice, passage: options.passage, sdp }),
        signal: abort.signal,
      })
      const session = (await response.json()) as Partial<LiveAnswer>
      if (stopped) return
      if (!response.ok || !session.sdp || !session.sessionId || !session.opening)
        throw new Error(session.message ?? `The service could not connect the preview (${response.status}).`)
      opening = session.opening
      await pc.setRemoteDescription({ type: 'answer', sdp: session.sdp })
    } catch (error) {
      if (!stopped) fail(error instanceof Error ? error.message : String(error))
    }
  })()
  return { stop }
}
