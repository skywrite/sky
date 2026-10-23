/**
 * The audition — every Live voice saying one passage, so the pick is
 * by ear. A textarea holds the passage; the voices sit in two groups; each
 * plays through a microphone-free WebRTC call of its own, since a voice is
 * fixed once it has spoken. No microphone is opened here. The page is
 * available directly at /voice/audition.
 */

import { Button, Textarea } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { playVoicePreview } from './voicePreview.ts'
import './voice.css'

type Group = 'male' | 'female'

interface AuditionInfo {
  passage: string
  groups: Record<Group, readonly string[]>
  current: string
  model: string
}

interface Playing {
  voice: string
  phase: 'connecting' | 'speaking'
}

const GROUP_LABEL: Record<Group, string> = { male: 'Male', female: 'Female' }

export function AuditionMain({ back }: { back: { label: string; onClick: () => void } }) {
  const [info, setInfo] = useState<AuditionInfo | null>(null)
  const [passage, setPassage] = useState('')
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [said, setSaid] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const callRef = useRef<ReturnType<typeof playVoicePreview> | null>(null)
  const queueRef = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    fetch('/voice/_api/audition')
      .then((r) => (r.ok ? (r.json() as Promise<AuditionInfo>) : Promise.reject(new Error(`${r.status}`))))
      .then((body) => {
        if (!alive) return
        setInfo(body)
        setPassage(new URLSearchParams(location.search).get('passage')?.trim() || body.passage)
      })
      .catch((err: Error) => alive && setError(`The audition could not load: ${err.message}`))
    return () => {
      alive = false
    }
  }, [])

  const stop = useCallback(() => {
    queueRef.current = []
    callRef.current?.stop()
    callRef.current = null
    setPlaying(null)
  }, [])

  const play = useCallback(
    (voice: string) => {
      callRef.current?.stop()
      setError(null)
      const audio = audioRef.current
      if (!audio) return
      setPlaying({ voice, phase: 'connecting' })
      callRef.current = playVoicePreview({
        voice,
        passage,
        audio,
        onSpeaking: () => setPlaying({ voice, phase: 'speaking' }),
        onTranscript: (text) => setSaid((previous) => ({ ...previous, [voice]: text })),
        onError: (message) => {
          queueRef.current = []
          setError(message)
        },
        onEnd: () => {
          callRef.current = null
          const next = queueRef.current.shift()
          if (next) play(next)
          else setPlaying(null)
        },
      })
    },
    [passage],
  )

  const playAll = (group: Group) => {
    const voices = [...(info?.groups[group] ?? [])]
    const first = voices.shift()
    if (!first) return
    queueRef.current = voices
    void play(first)
  }

  useEffect(() => stop, [stop])

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">Audition</span>
        <nav className="sky-tabs">
          {playing && (
            <Button size="sm" variant="danger-quiet" onClick={stop}>
              Stop
            </Button>
          )}
        </nav>
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-audition">
          <p className="sky-audition-lead">
            Every voice says the same passage. Edit it, then play a voice — or a whole group.
          </p>
          <Textarea
            variant="filled"
            autosize
            minRows={2}
            value={passage}
            onChange={(event) => setPassage(event.currentTarget.value)}
            aria-label="Passage"
            disabled={playing !== null}
          />
          {error && (
            <div className="sky-condensed" data-tone="failed">
              — {error} —
            </div>
          )}

          {info &&
            (['male', 'female'] as const).map((group) => (
              <section key={group} className="sky-audition-group">
                <div className="sky-audition-head">
                  <span className="sky-side-label">{GROUP_LABEL[group]}</span>
                  <Button size="xs" onClick={() => playAll(group)} disabled={playing !== null}>
                    Play all
                  </Button>
                </div>
                {info.groups[group].map((voice) => {
                  const isPlaying = playing?.voice === voice
                  return (
                    <div key={voice} className="sky-run" data-playing={isPlaying}>
                      <span className="sky-run-dot">
                        <span
                          className="sky-dot"
                          data-tone={isPlaying ? 'live' : voice === info.current ? 'done' : undefined}
                        />
                      </span>
                      <span className="sky-run-txt">
                        {voice}
                        {voice === info.current && <span className="sky-tag">default</span>}
                        <span className="sky-run-line">
                          {isPlaying
                            ? playing.phase === 'speaking'
                              ? 'speaking…'
                              : 'connecting…'
                            : (said[voice] ?? '')}
                        </span>
                      </span>
                      <Button size="xs" onClick={() => void play(voice)} disabled={playing !== null}>
                        Play
                      </Button>
                    </div>
                  )
                })}
              </section>
            ))}
          {info && <p className="sky-hint">{info.model} · grouped by ear; OpenAI does not label them.</p>}
        </div>
      </div>
      <audio ref={audioRef} autoPlay />
    </div>
  )
}
