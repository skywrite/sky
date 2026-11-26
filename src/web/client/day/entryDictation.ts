import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime'
import { liveOffer } from '../voice/liveTransport.ts'
import { describeVoiceError, micConstraints } from '../voice/voiceController.ts'
import { MicrophoneLevel } from './microphoneLevel.ts'

export type DictationPhase = 'idle' | 'connecting' | 'listening' | 'finishing'
export interface DictationView {
  phase: DictationPhase
  speech: string
  error?: string
  needsKey?: boolean
}

export function appendDictation(draft: string, speech: string): string {
  const phrase = speech.replace(/^[ \t]+/, '')
  if (!draft || !phrase || /\s$/.test(draft) || /^[\s.,!?]/.test(phrase)) return draft + phrase
  return draft + ' ' + phrase
}

// A day can have an inline composer and a Most Important dialog open together.
let recording: EntryDictation | undefined
export function stopDayMicrophone(): void {
  recording?.stop()
}

/** One press starts one transcription turn. Stop releases the mic, then waits for that turn's final text. */
export class EntryDictation {
  readonly microphone = new MicrophoneLevel()
  private abort = new AbortController()
  private phase: DictationPhase = 'connecting'
  private stream?: MediaStream
  private peer?: RTCPeerConnection
  private channel?: RTCDataChannel
  private deadline?: number
  private flush?: number
  private reconnect?: number
  private parts = new Map<string, string>()
  private completed = new Set<string>()
  private commitSent = false
  private committed?: string
  private needsKey = false

  constructor(
    private ymd: string,
    private changed: (view: DictationView) => void,
  ) {}

  private publish(error?: string): void {
    this.changed({
      phase: this.phase,
      speech: [...this.parts.values()].reduce(appendDictation, ''),
      error,
      needsKey: this.needsKey,
    })
  }

  private releaseMic(): void {
    if (recording === this) recording = undefined
    this.microphone.close()
    this.stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    this.stream = undefined
  }

  cancel(): void {
    this.abort.abort()
    window.clearTimeout(this.deadline)
    window.clearTimeout(this.flush)
    window.clearTimeout(this.reconnect)
    window.removeEventListener('pagehide', this.pageHidden)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    this.releaseMic()
    this.channel?.close()
    this.peer?.close()
  }

  finish(error?: string): void {
    if (this.abort.signal.aborted) return
    this.cancel()
    this.phase = 'idle'
    this.publish(error)
  }

  private pageHidden = () => this.finish()
  private visibilityChanged = () => {
    if (document.hidden && this.phase === 'listening') this.stop()
  }

  private event(raw: string): void {
    if (this.abort.signal.aborted) return
    let event: RealtimeServerEvent
    try {
      event = JSON.parse(raw) as RealtimeServerEvent
    } catch {
      return
    }
    switch (event?.type) {
      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta && !this.completed.has(event.item_id)) {
          this.parts.set(event.item_id, (this.parts.get(event.item_id) ?? '') + event.delta)
          this.publish()
        }
        break
      case 'conversation.item.input_audio_transcription.completed':
        this.parts.set(event.item_id, event.transcript)
        this.completed.add(event.item_id)
        this.publish()
        break
      case 'input_audio_buffer.committed':
        if (this.commitSent) this.committed = event.item_id
        break
      case 'conversation.item.input_audio_transcription.failed':
      case 'error':
        this.finish(
          event.error.code === 'input_audio_buffer_commit_empty'
            ? 'No speech was captured. Tap the mic to try again.'
            : 'OpenAI could not finish transcribing. Review the text or tap the mic to try again.',
        )
        return
    }
    if (this.phase === 'finishing' && this.committed && this.completed.has(this.committed)) this.finish()
  }

  private async credential(): Promise<string> {
    const response = await fetch(`/day/${this.ymd}/item/dictation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: this.abort.signal,
    })
    const data = (await response.json()) as { value?: string; error?: string; connection?: string }
    if (!response.ok || !data.value) {
      this.needsKey = data.connection === 'openai'
      throw new Error(data.error ?? 'Sky could not set up dictation. Open this day in Sky and try again.')
    }
    return data.value
  }

  async start(): Promise<void> {
    stopDayMicrophone()
    recording = this
    this.publish()
    const { signal } = this.abort
    window.addEventListener('pagehide', this.pageHidden)
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.deadline = window.setTimeout(
      () => this.finish('Dictation took too long to connect. Check microphone permission and tap the mic to retry.'),
      45_000,
    )
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined')
        throw new Error('Open Sky over HTTPS in a browser with microphone access to start dictation.')
      const permission = navigator.mediaDevices.getUserMedia(micConstraints(null))
      this.microphone.start()
      const stream = await permission
      if (signal.aborted) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('No microphone was found. Connect one or type in the field.')
      this.microphone.connect(stream)
      const peer = (this.peer = new RTCPeerConnection())
      // OpenAI negotiates an inactive audio channel for sendonly offers. Transcription still has no playback.
      peer.addTrack(track, stream)
      track.onended = () => this.stop()
      const channel = (this.channel = peer.createDataChannel('oai-events'))
      const lost = () => this.finish('The dictation connection closed. Review the text and tap the mic to continue.')
      channel.onclose = channel.onerror = lost
      peer.onconnectionstatechange = () => {
        if (signal.aborted) return
        window.clearTimeout(this.reconnect)
        if (peer.connectionState === 'disconnected') this.reconnect = window.setTimeout(lost, 5000)
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') lost()
      }
      channel.onmessage = (message) => this.event(message.data)
      channel.onopen = () => {
        if (signal.aborted) return
        if (document.hidden) return this.finish()
        const direction = peer.getTransceivers().find((t) => t.sender.track === track)?.currentDirection
        if (direction !== 'sendrecv' && direction !== 'sendonly')
          return this.finish('OpenAI connected without microphone audio. Tap the mic to reconnect.')
        window.clearTimeout(this.deadline)
        this.phase = 'listening'
        this.publish()
      }
      const [sdp, token] = await Promise.all([liveOffer(peer, signal), this.credential()])
      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/sdp' },
        body: sdp,
        signal,
      })
      if (!response.ok) throw new Error('OpenAI could not connect to the microphone. Tap the mic to try again.')
      const answer = await response.text()
      signal.throwIfAborted()
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch (error) {
      this.finish(
        error instanceof TypeError
          ? 'Could not connect for dictation. Check your connection and tap the mic again.'
          : describeVoiceError(error),
      )
    }
  }

  stop(): void {
    if (this.abort.signal.aborted || this.phase === 'finishing') return
    if (this.phase !== 'listening') return this.finish()
    this.phase = 'finishing'
    this.releaseMic()
    this.publish()
    // Media packets and the commit travel on different WebRTC channels. Let the last audio packets arrive.
    this.flush = window.setTimeout(() => {
      try {
        this.channel!.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        this.commitSent = true
      } catch {
        this.finish(
          'Dictation disconnected before the final words arrived. Review the text or tap the mic to continue.',
        )
      }
    }, 250)
    this.deadline = window.setTimeout(
      () => this.finish('The final transcript did not arrive. Review the text or tap the mic to continue.'),
      10_000,
    )
  }
}
