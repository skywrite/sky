import type { Page } from 'playwright'
import { assert, test } from '#test'
import { voiceConversation } from './chat/voiceTranscript.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { CALLS_URL, type VoiceEvent, type VoiceTurn } from './theme/client/voiceController.ts'

interface BrowserVoice {
  ready: number
  microphones: MediaStreamTrack[]
  connect: () => void
  emit: (event: VoiceEvent) => void
  fail: () => void
}

/** Exercise the real voice controller without a microphone, speaker output, or model connection. */
async function mockMedia(page: Page) {
  await page.addInitScript(() => {
    const context = new AudioContext()
    const peers: Peer[] = []
    const mock: BrowserVoice = {
      ready: 0,
      microphones: [],
      connect: () => {
        for (const peer of peers.slice(-2)) peer.connect()
      },
      emit: (event) => peers.at(-2)!.channel.emit(event),
      fail: () => {
        const peer = peers.at(-2)!
        peer.connectionState = 'failed'
        peer.onconnectionstatechange?.()
      },
    }
    Object.defineProperty(window, 'mockVoice', { value: mock })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const stream = context.createMediaStreamDestination().stream
        mock.microphones.push(...stream.getAudioTracks())
        return stream
      },
    })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] })
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
    }

    class Channel {
      readyState = 'connecting'
      onmessage?: (message: { data: string }) => void
      onopen?: () => void
      onclose?: () => void
      send(_value: string) {}
      close() {
        this.readyState = 'closed'
        this.onclose?.()
      }
      emit(event: VoiceEvent) {
        this.onmessage?.({ data: JSON.stringify(event) })
      }
    }
    class Peer {
      channel = new Channel()
      connectionState = 'new'
      ontrack?: (event: { streams: MediaStream[] }) => void
      onconnectionstatechange?: () => void
      constructor() {
        peers.push(this)
      }
      createDataChannel() {
        return this.channel
      }
      addTrack(_track: MediaStreamTrack, _stream: MediaStream) {}
      addTransceiver(_kind: string, _options: unknown) {}
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: 'mock-offer' })
      }
      setLocalDescription(_description: unknown) {
        return Promise.resolve()
      }
      setRemoteDescription(_description: unknown) {
        mock.ready++
        return Promise.resolve()
      }
      connect() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onopen?.()
        this.channel.emit({ type: 'session.created' })
        this.ontrack?.({ streams: [context.createMediaStreamDestination().stream] })
      }
      close() {
        this.connectionState = 'closed'
        this.onconnectionstatechange?.()
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer })
  })
}

async function speak(page: Page, question: string, answer: string) {
  await page.evaluate(
    ({ question, answer }) => {
      const { emit } = (window as unknown as { mockVoice: BrowserVoice }).mockVoice
      emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: question })
      emit({ type: 'response.created', response: { id: 'mock-response' } })
      emit({ type: 'output_audio_buffer.started', response_id: 'mock-response' })
      emit({ type: 'response.output_audio_transcript.delta', delta: answer, response_id: 'mock-response' })
      emit({ type: 'response.done', response: { id: 'mock-response', status: 'completed' } })
      emit({ type: 'output_audio_buffer.stopped', response_id: 'mock-response' })
    },
    { question, answer },
  )
}

test(
  {
    name: 'voice presence hides conversation text and preserves it and the draft through end and retry',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'voice-presence-', day: true },
      async ({ page, origin, errors }) => {
        const turns = [
          { role: 'user', content: 'Plan the Atlas launch.' },
          { role: 'assistant', content: 'Start with the demo.' },
        ]
        const handoffs: Array<{ after: number; turns: VoiceTurn[] }> = []
        const external: string[] = []
        const retiredAssets: string[] = []
        let refuse = false
        const failure = 'The test service could not keep the conversation. Try again.'
        await mockMedia(page)
        page.on('request', (request) => {
          const pathname = new URL(request.url()).pathname
          if (/\.(?:glb|gltf)$/.test(pathname) || pathname.includes('headaudio')) retiredAssets.push(pathname)
        })
        await page.route('**/*', (route) => {
          const url = route.request().url()
          if (url === CALLS_URL) return route.fulfill({ contentType: 'application/sdp', body: 'mock-answer' })
          if (new URL(url).origin === origin) return route.continue()
          external.push(url)
          return route.abort()
        })
        await page.route('**/voice/**', (route) =>
          route.fulfill({
            json: route.request().url().endsWith('/session')
              ? {
                  clientSecret: 'mock-sky-secret',
                  model: 'mock-realtime',
                  voice: 'mock-blue',
                  opening: 'Listen to the user.',
                  instructions: 'You are Sky.',
                  tools: [],
                  researcher: {
                    clientSecret: 'mock-sonny-secret',
                    voice: 'mock-amber',
                    instructions: 'You are Sonny.',
                  },
                }
              : { ok: true },
          }),
        )
        await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
        await page.route('**/chat/**', (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/settings')) {
            return route.fulfill({
              json: {
                model: {
                  current: 'test',
                  default: 'test',
                  choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
                },
                contextTokens: 0,
                saves: true,
                kept: 0,
                documents: 0,
              },
            })
          }
          if (pathname.endsWith('/voice')) {
            const body = route.request().postDataJSON() as (typeof handoffs)[number]
            handoffs.push(body)
            if (refuse) return route.fulfill({ status: 503, json: { message: failure } })
            const appended = voiceConversation(body.turns)
            turns.push(...appended)
            return route.fulfill({ json: { appended: appended.length } })
          }
          return route.fulfill({ json: { turns, documents: 0, kept: 0, busy: false } })
        })
        await page.goto(`${origin}/thread/voice-test`)
        await page.getByText('Start with the demo.', { exact: true }).waitFor()
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true, includeHidden: true })
        const presence = page.locator('.sky-voice-presence')
        const draft = 'Keep this unsent thought for later.'
        await composer.fill(draft)
        await page.getByRole('button', { name: 'Start voice chat', exact: true }).click()
        await page.locator('.sky-voice-bar[data-phase="starting"]').waitFor()
        assert({
          given: 'voice is connecting with a prior conversation and an unsent draft',
          should: 'show both agents and call controls while hiding the conversation and composer',
          actual: {
            presence: await presence.isVisible(),
            sky: await presence.getByText('Sky', { exact: true }).isVisible(),
            sonny: await presence.getByText('Sonny', { exact: true }).isVisible(),
            previous: await page.getByText('Start with the demo.', { exact: true }).isVisible(),
            composer: await composer.isVisible(),
            end: await page.getByRole('button', { name: 'End voice', exact: true }).isVisible(),
          },
          expected: { presence: true, sky: true, sonny: true, previous: false, composer: false, end: true },
        })
        await page.waitForFunction(() => (window as unknown as { mockVoice: BrowserVoice }).mockVoice.ready === 2)
        await page.evaluate(() => (window as unknown as { mockVoice: BrowserVoice }).mockVoice.connect())
        await page.locator('.sky-voice-bar[data-phase="live"]').waitFor()
        await page.locator('.sky-voice-presence[aria-busy="false"]').waitFor()
        assert({
          given: 'both cloud forms initialize in a connected call',
          should: 'render two accessible GPU visuals without avatar assets or a loading error',
          actual: {
            clouds: await presence.getByRole('img').count(),
            canvases: await presence.locator('canvas').evaluateAll((canvases) =>
              canvases.map((element) => {
                const canvas = element as HTMLCanvasElement
                const rect = canvas.getBoundingClientRect()
                return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0
              }),
            ),
            renderer: await presence
              .locator('canvas')
              .evaluateAll((canvases) =>
                canvases.map((canvas) =>
                  ['WebGPU', 'WebGL2'].includes((canvas as HTMLCanvasElement).dataset.renderer ?? ''),
                ),
              ),
            retry: await presence.getByRole('button', { name: 'Retry voice visuals', exact: true }).count(),
            retiredAssets,
          },
          expected: { clouds: 2, canvases: [true, true], renderer: [true, true], retry: 0, retiredAssets: [] },
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
        await page.getByRole('button', { name: 'End voice', exact: true }).click({ trial: true })
        assert({
          given: 'the voice stage is viewed on a narrow screen',
          should: 'keep both cloud forms inside the viewport and the end-call control available',
          actual: {
            clouds: await presence.locator('canvas').evaluateAll((canvases) =>
              canvases.map((canvas) => {
                const rect = canvas.getBoundingClientRect()
                return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0
              }),
            ),
            end: await page.getByRole('button', { name: 'End voice', exact: true }).isVisible(),
          },
          expected: { clouds: [true, true], end: true },
        })
        await page.setViewportSize({ width: 1280, height: 720 })
        await speak(page, 'What should the demo show?', 'Show the first complete workflow.')
        assert({
          given: 'speech recognition and agent transcript events arrive during the call',
          should: 'keep spoken text and the earlier chat out of view',
          actual: {
            question: await page.getByText('What should the demo show?', { exact: true }).isVisible(),
            answer: await page.getByText('Show the first complete workflow.', { exact: true }).isVisible(),
            previous: await page.getByText('Start with the demo.', { exact: true }).isVisible(),
            composer: await composer.isVisible(),
            presence: await presence.isVisible(),
          },
          expected: { question: false, answer: false, previous: false, composer: false, presence: true },
        })
        await page.getByRole('button', { name: 'End voice', exact: true }).click()
        await page.getByText('Sky: Show the first complete workflow.', { exact: true }).waitFor()
        assert({
          given: 'the user ends voice and its transcript is retained',
          should: 'restore the prior chat, spoken exchange, and unsent draft',
          actual: {
            previous: await page.getByText('Start with the demo.', { exact: true }).isVisible(),
            question: await page.getByText('What should the demo show?', { exact: true }).isVisible(),
            composer: await composer.isVisible(),
            draft: await composer.inputValue(),
            presence: await presence.count(),
          },
          expected: { previous: true, question: true, composer: true, draft, presence: 0 },
        })

        await page.getByRole('button', { name: 'Start voice chat', exact: true }).click()
        await page.waitForFunction(() => (window as unknown as { mockVoice: BrowserVoice }).mockVoice.ready === 4)
        await page.evaluate(() => (window as unknown as { mockVoice: BrowserVoice }).mockVoice.connect())
        await page.locator('.sky-voice-bar[data-phase="live"]').waitFor()
        await speak(page, 'Who should try it first?', 'Invite a small pilot group.')
        refuse = true
        await page.evaluate(() => (window as unknown as { mockVoice: BrowserVoice }).mockVoice.fail())
        await page.getByText(failure, { exact: true }).waitFor()
        assert({
          given: 'the connection fails and the service also refuses the transcript handoff',
          should: 'restore readable text and the draft, and hold new sends until retry',
          actual: {
            answer: await page.getByText('Invite a small pilot group.', { exact: true }).isVisible(),
            draft: await composer.inputValue(),
            composer: await composer.isVisible(),
            sendDisabled: await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(),
            presence: await presence.count(),
          },
          expected: { answer: true, draft, composer: true, sendDisabled: true, presence: 0 },
        })
        refuse = false
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await page.getByText('Sky: Invite a small pilot group.', { exact: true }).waitFor()
        assert({
          given: 'the transcript handoff succeeds on retry',
          should: 'keep the same turns once, release microphones, and enable the unchanged draft',
          actual: {
            handoffPositions: handoffs.map((body) => body.after),
            retryMatches: JSON.stringify(handoffs[1]) === JSON.stringify(handoffs[2]),
            messages: await page.locator('.sky-turn').count(),
            draft: await composer.inputValue(),
            sendEnabled: await page.getByRole('button', { name: 'Send', exact: true }).isEnabled(),
            stopped: await page.evaluate(() =>
              (window as unknown as { mockVoice: BrowserVoice }).mockVoice.microphones.map(
                (track) => track.readyState === 'ended',
              ),
            ),
            external,
            retiredAssets,
            errors: errors.filter((error) => !error.includes('503')),
          },
          expected: {
            handoffPositions: [2, 4, 4],
            retryMatches: true,
            messages: 6,
            draft,
            sendEnabled: true,
            stopped: [true, true],
            external: [],
            retiredAssets: [],
            errors: [],
          },
        })
      },
    )
  },
)
