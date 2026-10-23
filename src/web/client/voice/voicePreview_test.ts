import { assert, test } from '#test'
import { playVoicePreview } from './voicePreview.ts'

test('a Live preview supplies silent input without a microphone and releases it after audio drains', async () => {
  const saved = new Map<string, PropertyDescriptor | undefined>()
  const replace = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const timers = new Map<number, { callback: () => void; ms: number }>()
  let timerId = 0
  let now = 0
  const clock = Object.getOwnPropertyDescriptor(performance, 'now')
  const settle = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
  }
  const runTimers = async (ms: number) => {
    const pending = [...timers]
    for (const [id, timer] of pending)
      if (timer.ms === ms) {
        timers.delete(id)
        timer.callback()
      }
    await settle()
  }
  const track = {
    stopped: false,
    stop: () => {
      track.stopped = true
    },
  }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  let contextClosed = 0
  let sourceStarted = false
  let sourceStopped = false
  const source = {
    offset: { value: 1 },
    connect: () => {},
    start: () => {
      sourceStarted = true
    },
    stop: () => {
      sourceStopped = true
    },
  }
  const sent: Array<{ type: string; content?: string }> = []
  const channel = {
    readyState: 'connecting',
    onmessage: undefined as ((event: { data: string }) => void) | undefined,
    onopen: undefined as (() => void) | undefined,
    send: (text: string) => {
      sent.push(JSON.parse(text))
    },
    close: () => {
      channel.readyState = 'closed'
    },
  }
  let peer!: Peer
  class Peer {
    iceGatheringState = 'complete'
    connectionState = 'new'
    localDescription = { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' }
    ontrack?: (event: { streams: unknown[] }) => void
    tracks: unknown[] = []
    level = 0
    constructor() {
      peer = this
    }
    createDataChannel() {
      return channel
    }
    addTrack(value: unknown) {
      this.tracks.push(value)
    }
    async createOffer() {
      return this.localDescription
    }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async getStats() {
      return new Map([['audio', { id: 'audio', type: 'inbound-rtp', kind: 'audio', audioLevel: this.level }]])
    }
    close() {
      this.connectionState = 'closed'
    }
  }
  const audio = Object.assign(new EventTarget(), {
    srcObject: null as unknown,
    paused: true,
    currentTime: 1,
    muted: false,
    volume: 1,
    play: async () => {
      audio.paused = false
      audio.dispatchEvent(new Event('playing'))
    },
    pause: () => {
      audio.paused = true
    },
  })
  const errors: string[] = []
  const captions: string[] = []
  let speaking = 0
  let ended = 0
  const emit = (event: unknown) => channel.onmessage?.({ data: JSON.stringify(event) })
  let preview: ReturnType<typeof playVoicePreview> | undefined
  try {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    replace('window', {
      setTimeout: (callback: () => void, ms: number) => {
        timers.set(++timerId, { callback, ms })
        return timerId
      },
      clearTimeout: (id: number) => {
        timers.delete(id)
      },
    })
    replace('RTCPeerConnection', Peer)
    replace(
      'AudioContext',
      class {
        createConstantSource() {
          return source
        }
        createMediaStreamDestination() {
          return { stream }
        }
        async resume() {}
        async close() {
          contextClosed++
        }
      },
    )
    replace('fetch', async () =>
      Response.json({ sessionId: 'preview-test', sdp: 'answer', opening: 'Say the preview now.' }),
    )
    preview = playVoicePreview({
      voice: 'marin',
      audio: audio as unknown as HTMLAudioElement,
      onSpeaking: () => {
        speaking++
      },
      onTranscript: (text) => {
        captions.push(text)
      },
      onError: (error) => {
        errors.push(error)
      },
      onEnd: () => {
        ended++
      },
    })
    await settle()
    channel.readyState = 'open'
    channel.onopen?.()
    peer.ontrack?.({ streams: [{}] })
    emit({ type: 'session.started' })
    await runTimers(1000)
    assert({
      given: 'the preview connects and speakers warm up',
      should: 'run a generated silent track and request speech without opening a microphone',
      actual: [peer.tracks[0] === track, source.offset.value, sourceStarted, sent.map((event) => event.type)],
      expected: [true, 0, true, ['session.instructions.append']],
    })
    peer.level = 0.1
    await runTimers(150)
    emit({ type: 'session.output_transcript.delta', delta: 'Synthetic preview.' })
    peer.level = 0
    now = 2100
    await runTimers(150)
    preview.stop()
    assert({
      given: 'received audio and captions have drained',
      should: 'finish once and retain input only for the closing handshake',
      actual: [speaking, captions, ended, errors, track.stopped, sent.at(-1)?.type, audio.srcObject],
      expected: [1, ['Synthetic preview.'], 1, [], false, 'session.close', null],
    })
    emit({ type: 'session.closed' })
    assert({
      given: 'the Live session confirms it closed',
      should: 'release all generated audio, connection, and timers',
      actual: [track.stopped, sourceStopped, contextClosed, peer.connectionState, timers.size],
      expected: [true, true, 1, 'closed', 0],
    })
  } finally {
    preview?.stop()
    emit({ type: 'session.closed' })
    if (clock) Object.defineProperty(performance, 'now', clock)
    else Reflect.deleteProperty(performance, 'now')
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
