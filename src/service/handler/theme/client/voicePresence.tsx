import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { Voice } from './voice.tsx'
import type { Speaker } from './voiceController.ts'
import type { VoiceCloud } from './voiceScene.ts'
import './voicePresence.css'

const SPEAKERS: Speaker[] = ['sky', 'sonny']

/** The call occupies the conversation canvas; its transcript stays in the chat's history. */
export function VoicePresence({ voice }: { voice: Voice }) {
  const skyCanvas = useRef<HTMLCanvasElement>(null)
  const sonnyCanvas = useRef<HTMLCanvasElement>(null)
  const skyFigure = useRef<HTMLElement>(null)
  const sonnyFigure = useRef<HTMLElement>(null)
  const stateRef = useRef(voice.state)
  stateRef.current = voice.state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const motion = voice.audioMotion

  useEffect(() => {
    let disposed = false
    let ready = false
    let frame = 0
    let reportedError: string | null = null
    const clouds: Partial<Record<Speaker, VoiceCloud>> = {}
    const figures = { sky: skyFigure.current, sonny: sonnyFigure.current }
    const canvases = { sky: skyCanvas.current, sonny: sonnyCanvas.current }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    setLoading(true)
    setError(null)

    const draw = (time: number) => {
      if (disposed || document.hidden) return
      const levels = motion.sample()
      const state = stateRef.current
      for (const speaker of SPEAKERS) {
        const figure = figures[speaker]
        const listening = state.phase === 'live' && !state.muted && state.activity === 'listening'
        clouds[speaker]?.update(levels[speaker], time / 1000, reducedMotion.matches, listening)
        if (!figure) continue
        const speaking = levels[speaker] > 0.008
        figure.dataset.speaking = String(speaking)
        figure.style.setProperty('--voice-energy', String(levels[speaker]))
        const label = figure.querySelector('.sky-voice-agent-state')
        const status =
          state.phase === 'starting'
            ? 'Connecting…'
            : speaking
              ? 'Speaking'
              : speaker === 'sonny' && state.research.running
                ? 'Researching'
                : state.activity === 'checking' && speaker === 'sky'
                  ? 'Checking'
                  : state.muted
                    ? 'Microphone muted'
                    : 'Listening'
        if (label && label.textContent !== status) label.textContent = status
      }
      if (motion.error && motion.error !== reportedError) {
        reportedError = motion.error
        setError(motion.error)
      }
      frame = requestAnimationFrame(draw)
    }

    const onVisibilityChange = () => {
      cancelAnimationFrame(frame)
      if (ready && !disposed && !document.hidden) frame = requestAnimationFrame(draw)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const disposeClouds = () => {
      for (const speaker of SPEAKERS) {
        clouds[speaker]?.dispose()
        delete clouds[speaker]
      }
    }

    void import('./voiceScene.ts')
      .then(async ({ createVoiceCloud }) => {
        if (disposed) return
        const loaded = await Promise.allSettled(
          SPEAKERS.map(async (speaker) => {
            const canvas = canvases[speaker]
            if (!canvas) return
            const cloud = await createVoiceCloud(canvas, speaker)
            if (disposed) cloud.dispose()
            else clouds[speaker] = cloud
          }),
        )
        if (loaded.some((result) => result.status === 'rejected')) {
          disposeClouds()
          throw new Error('A voice visual could not load.')
        }
        if (!disposed) {
          ready = true
          setLoading(false)
          if (!document.hidden) frame = requestAnimationFrame(draw)
        }
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false)
          setError('The voice visuals couldn’t load. You can keep talking or retry.')
        }
      })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disposeClouds()
    }
  }, [motion, attempt])

  return (
    <section className="sky-voice-presence" aria-label="Voice conversation" aria-busy={loading}>
      <div className="sky-voice-forms">
        {SPEAKERS.map((speaker) => (
          <figure
            key={`${speaker}-${attempt}`}
            ref={speaker === 'sky' ? skyFigure : sonnyFigure}
            className="sky-voice-agent"
            data-speaker={speaker}
          >
            <div className="sky-voice-cloud">
              <canvas
                ref={speaker === 'sky' ? skyCanvas : sonnyCanvas}
                role="img"
                aria-label={
                  speaker === 'sky'
                    ? 'Animated blue clouds in a circle for Sky'
                    : 'Animated amber clouds in a triangle for Sonny'
                }
              />
            </div>
            <figcaption>
              <span className="sky-voice-agent-name">{speaker === 'sky' ? 'Sky' : 'Sonny'}</span>
              <span className="sky-voice-agent-state">Connecting…</span>
            </figcaption>
          </figure>
        ))}
      </div>
      {loading && (
        <p className="sky-voice-presence-note" role="status">
          Loading Sky and Sonny…
        </p>
      )}
      {error && (
        <div className="sky-voice-presence-note" role="status">
          <span>{error}</span>
          <Button
            size="sm"
            onClick={() => {
              void motion.start()
              setAttempt((value) => value + 1)
            }}
          >
            Retry voice visuals
          </Button>
        </div>
      )}
    </section>
  )
}
