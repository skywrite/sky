/**
 * Settings — the app's preferences, one short page per section.
 *
 * The sidebar swaps to the section list the way Explorer swaps to the
 * file tree. What a person changes here is written to
 * ~/.sky/config.jsonc through the service and applied on the spot:
 * theme and text size to this page, the voice to the next call. The
 * Advanced pane keeps the whole file readable — every key, its value,
 * and where it came from. Connections is the keychain's page — accounts
 * and keys, presence only — in settingsConnections.tsx. Experimental is
 * an empty pane, reserved: nothing is on it yet.
 */

import { Button, SegmentedControl, Select, useMantineColorScheme } from '@mantine/core'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { AboutMePane } from './settingsAboutMe.tsx'
import { Block, mono, refusalOf, Row, UNREACHABLE } from './settingsBlocks.tsx'
import { ConnectionsPane } from './settingsConnections.tsx'
import { AIPane } from './settingsModels.tsx'
import { PromptsMain } from './settingsPrompts.tsx'
import { SETTINGS_PAGES, type SettingsSection } from './settingsRoutes.ts'
import { whenSpeakersWarm } from './speakers.ts'
import { CALLS_URL } from './voice.tsx'
import { WritingVoicePane } from './writingVoice.tsx'
import './settings.css'

// ── What the service answers (mirrors handler/settings/mod.ts) ──────

export type Theme = 'system' | 'light' | 'dark'
export type TextSize = 'default' | 'large'

interface ModelRow {
  role: string
  label: string
  value: string
  profile: string
}

export interface ProfileRow {
  name: string
  builtin: boolean
  provider: string
  model: string
  baseUrl?: string
  contextWindow?: number
  options?: Record<string, unknown>
  roles: string[]
  overrides?: boolean
}

export interface ConfigRow {
  key: string
  value: string | number | boolean | string[] | null
  source: 'file' | 'default' | 'env'
  via?: string
}

export interface ConfigView {
  path: string
  exists: boolean
  version: number
  sections: Array<{ id: string; title: string; rows: ConfigRow[] }>
}

export interface SettingsData {
  theme: Theme
  textSize: TextSize
  voice: { current: string; researcherCurrent: string; groups: { male: string[]; female: string[] } }
  models: ModelRow[]
  profiles: ProfileRow[]
  writingVoice: { profile: string; choices: Array<{ value: string; label: string }> }
  providers: string[]
  memoryNotes: number
  notebook: {
    dir: string
    userDataDir: string
    inputDir: string
    outputDir: string
    editor: string | null
    editors: string[]
  }
  about: { version: string | null; date: string | null }
  advanced: ConfigView
}

// ── Talking to the service ──────────────────────────────────────────

/** One preference into the file. Resolves to null, or to what went wrong. */
export async function saveSetting(key: string, value: string): Promise<string | null> {
  const r = await fetch('/settings/_api/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => null)
  return refusalOf(r)
}

function reveal(target: 'dir' | 'userDataDir' | 'config'): void {
  void fetch('/settings/_api/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  }).catch(() => {})
}

/** Text size is a page-wide zoom; the browsers Sky meets all carry it. */
export function applyTextSize(size: TextSize): void {
  document.body.style.zoom = size === 'large' ? '1.15' : ''
}

/**
 * The saved appearance applied on any page, once, at app start: the theme
 * (config outranks the browser's remembered toggle) and the text size.
 */
export function useAppearanceBoot(): void {
  const { setColorScheme } = useMantineColorScheme()
  useEffect(() => {
    let alive = true
    fetch('/settings/_api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<SettingsData>) : null))
      .then((data) => {
        if (!alive || !data) return
        setColorScheme(data.theme === 'system' ? 'auto' : data.theme)
        applyTextSize(data.textSize)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [setColorScheme])
}

function useSettings() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reload = useCallback(() => {
    return fetch('/settings/_api/settings')
      .then(async (r) => {
        if (r.ok) {
          setData((await r.json()) as SettingsData)
          setNote(null)
        } else {
          const body = (await r.json().catch(() => ({}))) as { message?: string }
          setNote(body.message ?? `The service answered ${r.status}.`)
        }
      })
      .catch(() => setNote(UNREACHABLE))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Applies the change to the page at once; the file follows, or the page falls back. */
  const change = useCallback(
    (key: string, value: string, patch: (data: SettingsData) => SettingsData) => {
      setData((current) => (current ? patch(current) : current))
      void saveSetting(key, value).then((refusal) => {
        if (!refusal) return
        setNote(refusal)
        reload()
      })
    },
    [reload],
  )

  return { data, note, change, reload }
}

// ── Hear a voice: the audition's call, one row at a time ────────────

/** Once generation is done, playback is over this long after — if the buffer never says so. */
const DRAIN_FALLBACK_MS = 8000

function useHear() {
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const callRef = useRef<RTCPeerConnection | null>(null)

  const stop = useCallback(() => {
    callRef.current?.close()
    callRef.current = null
    setPlaying(null)
  }, [])

  const hear = useCallback(
    async (voice: string, passage?: string, playbackKey = voice) => {
      stop()
      setError(null)
      setPlaying(playbackKey)
      const pc = new RTCPeerConnection()
      callRef.current = pc
      const mine = () => callRef.current === pc
      const finish = () => {
        if (!mine()) return
        pc.close()
        callRef.current = null
        setPlaying(null)
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

        const dc = pc.createDataChannel('oai-events')
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
          const event = JSON.parse(message.data as string) as { type: string; error?: { message?: string } }
          switch (event.type) {
            case 'session.created':
              ready = true
              ask()
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
        finish()
      }
    },
    [stop],
  )

  useEffect(() => stop, [stop])

  return { playing, error, audioRef, hear, stop }
}

// ── Devices: the same choice the call bar writes ────────────────────

const DEVICES_KEY = 'sky-voice-devices'
const CAN_PICK_OUTPUT = 'setSinkId' in HTMLMediaElement.prototype

interface DeviceChoice {
  input?: string | null
  output?: string | null
}

function readChoice(): DeviceChoice {
  try {
    return (JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '{}') as DeviceChoice) ?? {}
  } catch {
    return {}
  }
}

function writeChoice(patch: DeviceChoice): void {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify({ ...readChoice(), ...patch }))
  } catch {
    // storage may be off; the call bar still offers the choice
  }
}

function deviceOptions(devices: MediaDeviceInfo[]): Array<{ value: string; label: string }> {
  return devices.map((device) => ({ value: device.deviceId, label: device.label }))
}

function useDevices() {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  })
  const [chosen, setChosen] = useState<DeviceChoice>(() => readChoice())

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let alive = true
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        if (!alive) return
        // Without microphone permission the labels are blank — nothing worth listing.
        const labeled = all.filter((device) => device.label)
        setDevices({
          inputs: labeled.filter((device) => device.kind === 'audioinput'),
          outputs: labeled.filter((device) => device.kind === 'audiooutput'),
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const choose = useCallback((patch: DeviceChoice) => {
    writeChoice(patch)
    setChosen(readChoice())
  }, [])

  return { devices, chosen, choose }
}

// ── The panes ───────────────────────────────────────────────────────

function AppearancePane({ data, change }: { data: SettingsData; change: ReturnType<typeof useSettings>['change'] }) {
  const { setColorScheme } = useMantineColorScheme()
  return (
    <Block>
      <Row label="Theme" sub="Follow the system, or pick one.">
        <SegmentedControl
          value={data.theme}
          onChange={(value) => {
            const theme = value as Theme
            setColorScheme(theme === 'system' ? 'auto' : theme)
            change('web.theme', theme, (current) => ({ ...current, theme }))
          }}
          data={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>
      <Row label="Text size" sub="Everything scales together." last>
        <SegmentedControl
          value={data.textSize}
          onChange={(value) => {
            const textSize = value as TextSize
            applyTextSize(textSize)
            change('web.textSize', textSize, (current) => ({ ...current, textSize }))
          }}
          data={[
            { value: 'default', label: 'Default' },
            { value: 'large', label: 'Larger' },
          ]}
        />
      </Row>
    </Block>
  )
}

function VoicePane({ data, change }: { data: SettingsData; change: ReturnType<typeof useSettings>['change'] }) {
  const { playing, error, audioRef, hear, stop } = useHear()
  const { devices, chosen, choose } = useDevices()
  const groups = [
    ['male', data.voice.groups.male],
    ['female', data.voice.groups.female],
  ] as const
  const speakers = [
    {
      name: 'Sky',
      key: 'voice.voice',
      field: 'current',
      note: 'The voice you talk with. A change speaks on your next call.',
      passage: undefined,
    },
    {
      name: 'Sonny',
      key: 'voice.researcherVoice',
      field: 'researcherCurrent',
      note: 'Brings back notebook research while you keep talking with Sky. A change speaks on your next call.',
      passage:
        "Sonny here. I'll look through the notebook and bring back what matters. Keep talking with Sky while I work.",
    },
  ] as const

  return (
    <>
      {speakers.map((speaker) => (
        <Block key={speaker.key} head={`${speaker.name}’s voice`} note={speaker.note}>
          <div className="sky-set-voices">
            {groups.map(([group, voices]) => (
              <div key={group}>
                {voices.map((voice) => (
                  <div key={voice} className="sky-set-voice">
                    <button
                      type="button"
                      className="sky-set-pick"
                      aria-pressed={data.voice[speaker.field] === voice}
                      aria-label={`${speaker.name}: ${voice}`}
                      onClick={() =>
                        change(speaker.key, voice, (current) => ({
                          ...current,
                          voice: { ...current.voice, [speaker.field]: voice },
                        }))
                      }
                    >
                      <span className="sky-set-radio" data-on={data.voice[speaker.field] === voice} />
                      <span className="sky-set-voice-name">{voice}</span>
                    </button>
                    <span className="sky-tag">{group}</span>
                    <Button
                      size="compact-sm"
                      onClick={() =>
                        playing === `${speaker.key}:${voice}`
                          ? stop()
                          : void hear(voice, speaker.passage, `${speaker.key}:${voice}`)
                      }
                      aria-label={
                        playing === `${speaker.key}:${voice}`
                          ? `Stop ${speaker.name} with ${voice}`
                          : `Hear ${speaker.name} with ${voice}`
                      }
                    >
                      {playing === `${speaker.key}:${voice}` ? '■ Stop' : '▸ Hear'}
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {error && <p className="sky-set-warn">{error}</p>}
          <div className="sky-set-foot">
            <Button size="sm" component="a" href="/voice/audition">
              Hear them all, one after another
            </Button>
          </div>
        </Block>
      ))}
      <Block head="Devices" note="Remembered on this computer.">
        {devices.inputs.length === 0 && devices.outputs.length === 0 ? (
          <p className="sky-set-sub">Device names appear once a call has used the microphone.</p>
        ) : (
          <>
            <Row label="Microphone">
              <Select
                size="sm"
                aria-label="Microphone"
                placeholder="System default"
                data={deviceOptions(devices.inputs)}
                value={chosen.input ?? null}
                onChange={(value) => choose({ input: value })}
                clearable
              />
            </Row>
            <Row label="Speaker" last>
              {CAN_PICK_OUTPUT && devices.outputs.length > 0 ? (
                <Select
                  size="sm"
                  aria-label="Speaker"
                  placeholder="System default"
                  data={deviceOptions(devices.outputs)}
                  value={chosen.output ?? null}
                  onChange={(value) => choose({ output: value })}
                  clearable
                />
              ) : (
                <span className="sky-set-sub">This browser routes sound to the system speaker.</span>
              )}
            </Row>
          </>
        )}
      </Block>
      <audio ref={audioRef} autoPlay />
    </>
  )
}

function NotebookPane({ data, change }: { data: SettingsData; change: ReturnType<typeof useSettings>['change'] }) {
  const { notebook } = data
  return (
    <>
      <Block head="Where things live">
        <Row label="Your notebook" sub="Every note, as plain files.">
          {mono(notebook.dir)}
          <Button size="sm" onClick={() => reveal('dir')}>
            Show in Finder
          </Button>
        </Row>
        <Row label="Attachments and data" sub="Images, recordings, Sky’s working files." last>
          {mono(notebook.userDataDir)}
          <Button size="sm" onClick={() => reveal('userDataDir')}>
            Show in Finder
          </Button>
        </Row>
      </Block>
      <Block head="Files">
        <Row label="Open files with" sub="For links that open a file outside Sky.">
          <Select
            size="sm"
            aria-label="Editor"
            data={notebook.editors}
            value={notebook.editor && notebook.editors.includes(notebook.editor) ? notebook.editor : null}
            placeholder={notebook.editor ?? 'Not set'}
            onChange={(value) => {
              if (!value) return
              change('editor', value, (current) => ({
                ...current,
                notebook: { ...current.notebook, editor: value },
              }))
            }}
          />
        </Row>
        <Row label="Save exports to" sub="PDFs, images, transcripts.">
          {mono(notebook.outputDir)}
        </Row>
        <Row label="Look for dropped files in" sub="When a command asks for a file and you don’t name one." last>
          {mono(notebook.inputDir)}
        </Row>
      </Block>
    </>
  )
}

function AdvancedPane({ data }: { data: SettingsData }) {
  const view = data.advanced
  return (
    <>
      <p className="sky-set-lead">
        For people who set Sky up by hand. These live in <code>{view.path}</code> — read them here, change them in the
        file. A value marked <em>default</em> is not in the file.
      </p>
      <Block head={view.exists ? `config.jsonc · version ${view.version}` : 'config.jsonc — not written yet'}>
        {view.sections.map((section) => (
          <Fragment key={section.id}>
            <div className="sky-set-adv-label">{section.title}</div>
            {section.rows.map((row) => (
              <Fragment key={row.key}>
                <div className="sky-set-adv-row" data-source={row.source}>
                  <span className="sky-set-adv-key">{row.key}</span>
                  <span className="sky-set-adv-value">
                    {row.value === null ? (
                      <span className="sky-set-unset">not set</span>
                    ) : Array.isArray(row.value) ? (
                      row.value.length === 0 ? (
                        <span className="sky-set-unset">none</span>
                      ) : (
                        <ul>
                          {row.value.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      )
                    ) : (
                      String(row.value)
                    )}
                  </span>
                  <span className="sky-set-adv-source">
                    {row.source === 'env' ? `env · ${row.via}` : row.source === 'default' ? 'default' : ''}
                  </span>
                </div>
              </Fragment>
            ))}
          </Fragment>
        ))}
        <div className="sky-set-foot">
          <Button size="sm" onClick={() => reveal('config')}>
            Open config file
          </Button>
        </div>
      </Block>
    </>
  )
}

function AboutPane({ data }: { data: SettingsData }) {
  const { about } = data
  return (
    <Block>
      <Row label="Sky" sub={about.version ? `Build ${about.version} · ${about.date ?? ''}` : 'Build unknown'}>
        <Button size="sm" component="a" href="https://github.com/skywrite/sky/blob/main/docs/upgrade.md">
          How to update
        </Button>
      </Row>
      <Row label="Service" sub="Runs on this Mac and keeps the notebook in sync." last>
        <span className="sky-set-status">Running</span>
      </Row>
    </Block>
  )
}

// ── The page ────────────────────────────────────────────────────────

export function SettingsMain({
  section,
  path,
  navigate,
  back,
}: {
  section: SettingsSection
  path: string
  navigate: (to: string) => void
  back: { label: string; onClick: () => void }
}) {
  const { data, note, change, reload } = useSettings()
  const page = SETTINGS_PAGES[section]
  if (section === 'prompts') return <PromptsMain path={path} navigate={navigate} back={back} />

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-set-breadcrumb">
          Settings
          {page.group && (
            <>
              <span aria-hidden="true"> / </span>
              {page.group}
            </>
          )}
        </span>
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-set">
          <div className="sky-set-heading">
            <h1>{page.label}</h1>
            <p>{page.description}</p>
          </div>
          {note && <div className="sky-condensed">— {note} —</div>}
          {section === 'about-me' ? (
            <AboutMePane memoryNotes={data?.memoryNotes ?? 0} />
          ) : section === 'experimental' ? null : (
            data &&
            (section === 'appearance' ? (
              <AppearancePane data={data} change={change} />
            ) : section === 'voice' ? (
              <VoicePane data={data} change={change} />
            ) : section === 'writing-voice' ? (
              <WritingVoicePane
                model={data.writingVoice}
                onModelChange={(profile) =>
                  change('ai.writingVoiceProfile', profile, (current) => ({
                    ...current,
                    writingVoice: { ...current.writingVoice, profile },
                  }))
                }
              />
            ) : section === 'models' ? (
              <AIPane data={data} reload={reload} />
            ) : section === 'connections' ? (
              <ConnectionsPane />
            ) : section === 'notebook' ? (
              <NotebookPane data={data} change={change} />
            ) : section === 'advanced' ? (
              <AdvancedPane data={data} />
            ) : (
              <AboutPane data={data} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
