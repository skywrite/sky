/**
 * The audition — every Realtime voice saying one passage, so the pick is
 * by ear. A textarea holds the passage; the voices sit in two groups; each
 * plays through a receive-only WebRTC call of its own, since a voice is
 * fixed once it has spoken. No microphone is opened here. The page is
 * reached by ai:voice:audition, not from the sidebar.
 */

import { Button, Textarea } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { whenSpeakersWarm } from './speakers.ts'
import { CALLS_URL } from './voice.tsx'
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

/** Once generation is done, playback is over this long after — if the buffer never says so. */
const DRAIN_FALLBACK_MS = 8000

const GROUP_LABEL: Record<Group, string> = { male: 'Male', female: 'Female' }

export function AuditionMain({ back }: { back: { label: string; onClick: () => void } }) {
  const [info, setInfo] = useState<AuditionInfo | null>(null)
  const [passage, setPassage] = useState('')
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [said, setSaid] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const callRef = useRef<{ pc: RTCPeerConnection; dc: RTCDataChannel } | null>(null)
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

  const hangUp = () => {
    const call = callRef.current
    callRef.current = null
    if (!call) return
    try {
      call.dc.close()
    } catch {
      // already closed
    }
    call.pc.close()
  }

  const stop = useCallback(() => {
    queueRef.current = []
    hangUp()
    setPlaying(null)
  }, [])

  // One voice: mint, connect receive-only, ask for the passage once the
  // speakers are warm, hang up when the buffer has drained — then the next.
  const play = useCallback(
    async (voice: string) => {
      hangUp()
      setError(null)
      setPlaying({ voice, phase: 'connecting' })
      const pc = new RTCPeerConnection()
      const dc = pc.createDataChannel('oai-events')
      callRef.current = { pc, dc }
      const mine = () => callRef.current?.pc === pc

      const finish = () => {
        if (!mine()) return
        hangUp()
        const next = queueRef.current.shift()
        if (next) void play(next)
        else setPlaying(null)
      }

      try {
        const minted = await fetch('/voice/_api/audition/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice, passage }),
        })
        const session = (await minted.json().catch(() => ({}))) as {
          clientSecret?: string
          opening?: string
          message?: string
        }
        if (!minted.ok || !session.clientSecret || !session.opening) {
          throw new Error(session.message ?? `The service answered ${minted.status}.`)
        }
        if (!mine()) return

        let ready = false
        let warm = false
        let asked = false
        const ask = () => {
          if (asked || !ready || !warm || !mine()) return
          asked = true
          dc.send(JSON.stringify({ type: 'response.create', response: { instructions: session.opening } }))
        }
        let drain: number | null = null
        dc.onmessage = (message) => {
          const event = JSON.parse(message.data as string) as {
            type: string
            transcript?: string
            error?: { message?: string }
          }
          switch (event.type) {
            case 'session.created':
              ready = true
              ask()
              break
            case 'output_audio_buffer.started':
              setPlaying({ voice, phase: 'speaking' })
              break
            case 'response.output_audio_transcript.done':
              setSaid((prev) => ({ ...prev, [voice]: (event.transcript ?? '').trim() }))
              break
            case 'response.done':
              drain = window.setTimeout(finish, DRAIN_FALLBACK_MS)
              break
            case 'output_audio_buffer.stopped':
              if (drain) window.clearTimeout(drain)
              finish()
              break
            case 'error':
              setError(event.error?.message ?? 'Realtime error')
              finish()
              break
          }
        }
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.ontrack = (event) => {
          const el = audioRef.current
          if (!el) return
          el.srcObject = event.streams[0] ?? null
          void whenSpeakersWarm(el).then(() => {
            warm = true
            ask()
          })
          void el.play().catch(() => {})
        }
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') {
            setError('The connection failed.')
            finish()
          }
        }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const answer = await fetch(CALLS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
          body: offer.sdp,
        })
        if (!answer.ok) throw new Error(`OpenAI refused the call (${answer.status}).`)
        await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
      } catch (err) {
        if (!mine()) return
        setError((err as Error).message)
        queueRef.current = []
        hangUp()
        setPlaying(null)
      }
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
            <Button size="sm" color="red" onClick={stop}>
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
