import { assert, test } from '#test'
import { VoiceAudioLevels } from './voiceAudio.ts'

class AudioNodeStub {
  connections: unknown[] = []
  disconnected = false
  connect(node: unknown) {
    this.connections.push(node)
  }
  disconnect() {
    this.disconnected = true
    this.connections = []
  }
}

class Analyser extends AudioNodeStub {
  fftSize = 0
  amplitude = 0
  getFloatTimeDomainData(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) samples[i] = this.amplitude * (i % 2 ? 1 : -1)
  }
}

class Context {
  state = 'suspended'
  currentTime = 0
  resumed = 0
  closed = 0
  resumeError: Error | null = null
  resumePending: Promise<void> | null = null
  sources: AudioNodeStub[] = []
  analysers: Analyser[] = []
  streams: MediaStream[] = []
  destination = new AudioNodeStub()
  createMediaStreamSource(stream: MediaStream) {
    const node = new AudioNodeStub()
    this.sources.push(node)
    this.streams.push(stream)
    return node
  }
  createAnalyser() {
    const node = new Analyser()
    this.analysers.push(node)
    return node
  }
  async resume() {
    this.resumed++
    if (this.resumeError) throw this.resumeError
    if (this.resumePending) await this.resumePending
    this.state = 'running'
  }
  async close() {
    this.closed++
    this.state = 'closed'
  }
}

function playback() {
  const track = { enabled: true, muted: false, readyState: 'live', stopped: false }
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream
  const element = {
    srcObject: stream as MediaStream | null,
    muted: false,
    paused: false,
    ended: false,
    volume: 1,
    sinkId: 'speaker-1',
  }
  return { track, stream, element }
}

function harness() {
  const sky = playback()
  const sonny = playback()
  const elements = { sky, sonny }
  const context = new Context()
  const motion = new VoiceAudioLevels((speaker) => elements[speaker].element as HTMLAudioElement, {
    createContext: () => context as unknown as AudioContext,
  })
  const frame = (seconds = 1 / 60) => {
    context.currentTime += seconds
    return motion.sample()
  }
  const voiced = () => {
    motion.sample()
    for (const analyser of context.analysers) analyser.amplitude = 0.15
    for (let i = 0; i < 12; i++) frame()
  }
  return { motion, context, sky, sonny, frame, voiced }
}

test('audio motion follows independent remote output and never changes audible playback routing', async () => {
  const h = harness()
  const starting = h.motion.start()
  assert({
    given: 'a voice-start user gesture',
    should: 'resume the browser context synchronously',
    actual: h.context.resumed,
    expected: 1,
  })
  await starting
  h.motion.sample()
  h.context.analysers[0].amplitude = 0.15
  for (let i = 0; i < 12; i++) h.frame()
  const levels = h.motion.sample()
  assert({
    given: 'Sky has audio while Sonny has silent samples',
    should: 'animate only Sky and keep both HTML output devices untouched without an extra audio route',
    actual: {
      sky: levels.sky > 0.5,
      sonny: levels.sonny,
      devices: [h.sky.element.sinkId, h.sonny.element.sinkId],
      changedElements: [h.sky.element.paused, h.sky.element.muted, h.sonny.element.paused, h.sonny.element.muted],
      extraPlayback: h.context.sources.some((source) => source.connections.includes(h.context.destination)),
    },
    expected: {
      sky: true,
      sonny: 0,
      devices: ['speaker-1', 'speaker-1'],
      changedElements: [false, false, false, false],
      extraPlayback: false,
    },
  })
  h.motion.stop()
  assert({
    given: 'the visual analysis stops',
    should: 'release analysis resources without stopping the remote streams or altering playback',
    actual: {
      sources: h.context.sources.every((source) => source.disconnected),
      analysers: h.context.analysers.every((analyser) => analyser.disconnected),
      contexts: h.context.closed,
      streamRetained: h.sky.element.srcObject === h.sky.stream,
      paused: h.sky.element.paused,
      levels: h.motion.sample(),
    },
    expected: {
      sources: true,
      analysers: true,
      contexts: 1,
      streamRetained: true,
      paused: false,
      levels: { sky: 0, sonny: 0 },
    },
  })
})

test('voice energy settles after silence and resumes after interruption', async () => {
  const h = harness()
  await h.motion.start()
  h.voiced()
  const voiced = h.motion.sample().sky > 0.5
  h.context.analysers[0].amplitude = 0
  const release = h.frame().sky
  for (let i = 0; i < 60; i++) h.frame()
  const settled = h.motion.sample().sky
  h.context.analysers[0].amplitude = 0.15
  h.frame()
  h.sky.element.muted = true
  const interrupted = h.frame().sky
  h.sky.element.muted = false
  const resumed = h.frame().sky > 0
  assert({
    given: 'speech, a silent pause, and an interruption followed by new speech',
    should: 'release smoothly into silence, clear muted output immediately, and resume with current audio',
    actual: { voiced, release: release > 0 && release < 0.7, settled, interrupted, resumed },
    expected: { voiced: true, release: true, settled: 0, interrupted: 0, resumed: true },
  })
  h.motion.stop()
})

for (const gate of ['muted', 'paused', 'ended', 'volume', 'track-muted', 'track-disabled', 'track-ended', 'context']) {
  test(`audio motion clears immediately when output becomes ${gate}`, async () => {
    const h = harness()
    await h.motion.start()
    h.voiced()
    const before = h.motion.sample().sky > 0
    if (gate === 'muted') h.sky.element.muted = true
    if (gate === 'paused') h.sky.element.paused = true
    if (gate === 'ended') h.sky.element.ended = true
    if (gate === 'volume') h.sky.element.volume = 0
    if (gate === 'track-muted') h.sky.track.muted = true
    if (gate === 'track-disabled') h.sky.track.enabled = false
    if (gate === 'track-ended') h.sky.track.readyState = 'ended'
    if (gate === 'context') h.context.state = 'suspended'
    h.frame()
    assert({
      given: 'active speech whose actual output becomes inaudible',
      should: 'clear the visual energy on the next frame',
      actual: { before, level: h.motion.sample().sky },
      expected: { before: true, level: 0 },
    })
    h.motion.stop()
  })
}

test('replacing or detaching a stream discards its samples without disturbing the other speaker', async () => {
  const h = harness()
  await h.motion.start()
  h.voiced()
  const oldSource = h.context.sources[0]
  const newPlayback = playback()
  h.sky.element.srcObject = newPlayback.stream
  h.frame()
  assert({
    given: 'a new remote stream replaces the speaking stream',
    should: 'detach the previous source, clear its energy, and continue sampling the other speaker',
    actual: {
      oldDisconnected: oldSource.disconnected,
      connectedNew: h.context.streams.at(-1) === newPlayback.stream,
      sky: h.motion.sample().sky,
      sonny: h.motion.sample().sonny > 0,
    },
    expected: { oldDisconnected: true, connectedNew: true, sky: 0, sonny: true },
  })
  const newSource = h.context.sources.at(-1)!
  h.sky.element.srcObject = null
  h.frame()
  assert({
    given: 'the replacement stream is detached',
    should: 'disconnect its analysis while the other speaker remains active',
    actual: { disconnected: newSource.disconnected, sky: h.motion.sample().sky, sonny: h.motion.sample().sonny > 0 },
    expected: { disconnected: true, sky: 0, sonny: true },
  })
  h.motion.stop()
})

test('voice energy accounts for output volume and ignores the noise floor', async () => {
  const h = harness()
  await h.motion.start()
  h.sky.element.volume = 0.25
  h.voiced()
  const levels = h.motion.sample()
  const relative = Math.abs(levels.sky / levels.sonny - 0.25) < 0.001
  for (const analyser of h.context.analysers) analyser.amplitude = 0.003
  for (let i = 0; i < 60; i++) h.frame()
  assert({
    given: 'the same speech at quarter volume and then quiet background samples',
    should: 'scale visual energy with audible volume and settle below the noise floor',
    actual: { relative, levels: h.motion.sample() },
    expected: { relative: true, levels: { sky: 0, sonny: 0 } },
  })
  h.motion.stop()
})

test('starting repeatedly shares a pending resume and stopping repeatedly closes once', async () => {
  const h = harness()
  let resolve!: () => void
  h.context.resumePending = new Promise<void>((done) => (resolve = done))
  const first = h.motion.start()
  const second = h.motion.start()
  const shared = first === second
  resolve()
  await first
  await h.motion.start()
  h.motion.stop()
  h.motion.stop()
  assert({
    given: 'multiple starts while resuming, another while running, and repeated teardown',
    should: 'share the resume operation and release the context only once',
    actual: { shared, resumes: h.context.resumed, closes: h.context.closed },
    expected: { shared: true, resumes: 1, closes: 1 },
  })
})

test('a late resume rejection cannot alter a new call', async () => {
  const oldContext = new Context()
  const newContext = new Context()
  let reject!: (error: Error) => void
  oldContext.resumePending = new Promise<void>((_, fail) => (reject = fail))
  let count = 0
  const audio = playback()
  const motion = new VoiceAudioLevels(() => audio.element as HTMLAudioElement, {
    createContext: () => (count++ ? newContext : oldContext) as unknown as AudioContext,
  })
  const first = motion.start()
  motion.stop()
  await motion.start()
  motion.sample()
  reject(new Error('Old context closed'))
  await first
  newContext.analysers[0].amplitude = 0.15
  newContext.currentTime += 1 / 60
  assert({
    given: 'the first call ends during context resume and another call starts',
    should: 'ignore the old rejection and retain the new call’s analysis',
    actual: {
      oldClosed: oldContext.closed,
      newContext: newContext.state,
      error: motion.error,
      level: motion.sample().sky > 0,
    },
    expected: { oldClosed: 1, newContext: 'running', error: null, level: true },
  })
  motion.stop()
})

for (const failure of ['context', 'resume'] as const) {
  test(`retry recovers audio analysis after a ${failure} failure without restarting playback`, async () => {
    const contexts: Context[] = []
    const playbackState = playback()
    let attempts = 0
    const motion = new VoiceAudioLevels(() => playbackState.element as HTMLAudioElement, {
      createContext: () => {
        attempts++
        if (attempts === 1 && failure === 'context') throw new Error('Audio unavailable')
        const context = new Context()
        if (attempts === 1 && failure === 'resume') context.resumeError = new Error('Gesture required')
        contexts.push(context)
        return context as unknown as AudioContext
      },
    })
    await motion.start()
    motion.sample()
    const failedContext = contexts.at(-1)
    const failureVisible = Boolean(motion.error)
    await motion.start()
    motion.sample()
    const context = contexts.at(-1)!
    context.analysers[0].amplitude = 0.15
    context.currentTime += 1 / 60
    const levels = motion.sample()
    assert({
      given: 'failed animation analysis is retried while the same call continues playing',
      should: 'release the failed context, clear the error, and animate current speech',
      actual: {
        failureVisible,
        attempts,
        failedContextClosed: !failedContext || failedContext.closed === 1,
        error: motion.error,
        audioMeasured: levels.sky > 0,
        playbackUnchanged: playbackState.element.srcObject === playbackState.stream && !playbackState.element.paused,
      },
      expected: {
        failureVisible: true,
        attempts: 2,
        failedContextClosed: true,
        error: null,
        audioMeasured: true,
        playbackUnchanged: true,
      },
    })
    motion.stop()
  })
}
