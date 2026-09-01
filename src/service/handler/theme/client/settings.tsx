/**
 * Settings — the app's preferences, one short page per section.
 *
 * The sidebar swaps to the section list the way Explorer swaps to the
 * file tree. What a person changes here is written to
 * ~/.sky/config.jsonc through the service and applied on the spot:
 * theme and text size to this page, the voice to the next call. The
 * Advanced pane keeps the whole file readable — every key, its value,
 * and where it came from. Accounts and API keys arrive with the
 * keychain rung.
 */

import { Button, SegmentedControl, Select, Textarea, TextInput, useMantineColorScheme } from '@mantine/core'
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { whenSpeakersWarm } from './speakers.ts'
import { CALLS_URL } from './voice.tsx'
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

interface ProfileRow {
  name: string
  builtin: boolean
  provider: string
  model: string
  baseUrl?: string
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
  voice: { current: string; groups: { male: string[]; female: string[] } }
  models: ModelRow[]
  profiles: ProfileRow[]
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

// ── Sections and routes ─────────────────────────────────────────────

export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'voice', label: 'Voice' },
  { id: 'ai', label: 'AI' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

/** The open section, or null when the path is not settings at all. */
export function settingsSectionOf(pathname: string): SettingsSection | null {
  if (!pathname.startsWith('/settings')) return null
  const id = pathname.match(/^\/settings\/([a-z]+)$/)?.[1]
  return SETTINGS_SECTIONS.some((section) => section.id === id) ? (id as SettingsSection) : 'appearance'
}

export function settingsHref(section: SettingsSection): string {
  return section === 'appearance' ? '/settings' : `/settings/${section}`
}

// ── Talking to the service ──────────────────────────────────────────

const UNREACHABLE = "Couldn't reach sky — is the service running?"

/** One preference into the file. Resolves to null, or to what went wrong. */
export async function saveSetting(key: string, value: string): Promise<string | null> {
  const r = await fetch('/settings/_api/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => null)
  if (!r) return UNREACHABLE
  if (r.ok) return null
  const body = (await r.json().catch(() => ({}))) as { message?: string }
  return body.message ?? `The service answered ${r.status}.`
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
    fetch('/settings/_api/settings')
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

  useEffect(reload, [reload])

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

// ── Building blocks ─────────────────────────────────────────────────

function Block({ head, note, children }: { head?: string; note?: string; children: ReactNode }) {
  return (
    <div className="sky-block">
      {head && <div className="sky-block-head">{head}</div>}
      <div className="sky-block-pad">
        {note && <p className="sky-set-note">{note}</p>}
        {children}
      </div>
    </div>
  )
}

function Row({ label, sub, children, last }: { label: string; sub?: string; children?: ReactNode; last?: boolean }) {
  return (
    <div className="sky-set-row" data-last={last}>
      <div className="sky-set-txt">
        <div>{label}</div>
        {sub && <div className="sky-set-sub">{sub}</div>}
      </div>
      <div className="sky-set-ctl">{children}</div>
    </div>
  )
}

const mono = (text: string) => <span className="sky-set-mono">{text}</span>

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
    async (voice: string) => {
      stop()
      setError(null)
      setPlaying(voice)
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
          body: JSON.stringify({ voice }),
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
  const pick = (voice: string) =>
    change('voice.voice', voice, (current) => ({ ...current, voice: { ...current.voice, current: voice } }))

  return (
    <>
      <Block head="Sky’s voice" note="The voice you talk with. A change speaks on your next call.">
        <div className="sky-set-voices">
          {groups.map(([group, voices]) => (
            <div key={group}>
              {voices.map((voice) => (
                <div key={voice} className="sky-set-voice">
                  <button
                    type="button"
                    className="sky-set-pick"
                    aria-pressed={data.voice.current === voice}
                    onClick={() => pick(voice)}
                  >
                    <span className="sky-set-radio" data-on={data.voice.current === voice} />
                    <span className="sky-set-voice-name">{voice}</span>
                  </button>
                  <span className="sky-tag">{group}</span>
                  <Button
                    size="compact-sm"
                    onClick={() => (playing === voice ? stop() : void hear(voice))}
                    aria-label={playing === voice ? `Stop ${voice}` : `Hear ${voice}`}
                  >
                    {playing === voice ? '■ Stop' : '▸ Hear'}
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

/** One knob per line reads better than a JSON blob: `effort xhigh · thinking {"type":"adaptive"}`. */
function knobs(options: Record<string, unknown> | undefined): string {
  if (!options) return ''
  return Object.entries(options)
    .map(([key, value]) => `${key} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
}

function ProfileForm({
  providers,
  initial,
  onDone,
  onCancel,
}: {
  providers: string[]
  initial?: ProfileRow
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? providers[0] ?? 'anthropic')
  const [model, setModel] = useState(initial?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [options, setOptions] = useState(initial?.options ? JSON.stringify(initial.options, null, 2) : '')
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    let parsedOptions: Record<string, unknown> | undefined
    if (options.trim()) {
      try {
        const parsed = JSON.parse(options) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
        parsedOptions = parsed as Record<string, unknown>
      } catch {
        setWarn('Options must be a JSON object, like {"temperature": 0.2}.')
        return
      }
    }
    setBusy(true)
    const r = await fetch('/settings/_api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        provider,
        model,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(parsedOptions ? { options: parsedOptions } : {}),
      }),
    }).catch(() => null)
    setBusy(false)
    if (!r) {
      setWarn(UNREACHABLE)
      return
    }
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { message?: string }
      setWarn(body.message ?? `The service answered ${r.status}.`)
      return
    }
    onDone()
  }

  return (
    <div className="sky-set-form">
      <div className="sky-set-form-grid">
        <TextInput
          size="sm"
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={Boolean(initial)}
          placeholder="scout, writing, local-fast…"
        />
        <Select size="sm" label="Provider" data={providers} value={provider} onChange={(v) => v && setProvider(v)} />
        <TextInput
          size="sm"
          label="Model"
          value={model}
          onChange={(e) => setModel(e.currentTarget.value)}
          placeholder="claude-sonnet-5, gpt-5.5, llama3…"
        />
        <TextInput
          size="sm"
          label="Server (optional)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          placeholder="http://localhost:11434 — for a local server"
        />
      </div>
      <Textarea
        size="sm"
        label="Options (optional, JSON)"
        autosize
        minRows={2}
        value={options}
        onChange={(e) => setOptions(e.currentTarget.value)}
        placeholder='{"effort": "xhigh"} or {"temperature": 0.2}'
        classNames={{ input: 'sky-set-mono-input' }}
      />
      {warn && <p className="sky-set-warn">{warn}</p>}
      <div className="sky-set-form-foot">
        <Button
          size="sm"
          variant="light"
          color="blue"
          disabled={busy || !name.trim() || !model.trim()}
          onClick={() => void save()}
        >
          {initial ? 'Save changes' : 'Save configuration'}
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function AIPane({ data, reload }: { data: SettingsData; reload: () => void }) {
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const remove = async (name: string) => {
    setConfirming(null)
    await fetch(`/settings/_api/profile/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => null)
    reload()
  }
  const done = () => {
    setEditing(null)
    reload()
  }

  return (
    <>
      <Block head="Models" note="What Sky thinks with. Pointing a role at a configuration comes next.">
        {data.models.map((model, index) => (
          <Fragment key={model.role}>
            <Row label={model.label} last={index === data.models.length - 1}>
              <span className="sky-set-value">{model.value}</span>
              {mono(model.profile)}
            </Row>
          </Fragment>
        ))}
      </Block>
      <Block
        head="Model configurations"
        note="A configuration names a provider, a model, and its knobs. Yours are saved to the file and read on every run; the built-ins ship with Sky."
      >
        {data.profiles.map((profile) => (
          <Fragment key={`${profile.builtin ? 'builtin' : 'yours'}-${profile.name}`}>
            {editing === profile.name && !profile.builtin ? (
              <ProfileForm
                providers={data.providers}
                initial={profile}
                onDone={done}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="sky-set-prof">
                <div className="sky-set-prof-txt">
                  <div className="sky-set-prof-name">
                    <span className="sky-set-mono">{profile.name}</span>
                    {profile.overrides && <span className="sky-tag">overrides the built-in</span>}
                    {profile.roles.map((role) => (
                      <span key={role} className="sky-set-role">
                        {role}
                      </span>
                    ))}
                  </div>
                  <div className="sky-set-sub">
                    {profile.provider} · {profile.model}
                    {profile.baseUrl ? ` · ${profile.baseUrl}` : ''}
                    {profile.options ? ` · ${knobs(profile.options)}` : ''}
                  </div>
                </div>
                <div className="sky-set-ctl">
                  {profile.builtin ? (
                    <span className="sky-tag">built-in</span>
                  ) : (
                    <>
                      <Button size="compact-sm" onClick={() => setEditing(profile.name)}>
                        Edit
                      </Button>
                      {confirming === profile.name ? (
                        <Button size="compact-sm" color="red" variant="light" onClick={() => void remove(profile.name)}>
                          Really delete
                        </Button>
                      ) : (
                        <Button size="compact-sm" onClick={() => setConfirming(profile.name)}>
                          Delete
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        ))}
        {editing === 'new' ? (
          <ProfileForm providers={data.providers} onDone={done} onCancel={() => setEditing(null)} />
        ) : (
          <div className="sky-set-foot">
            <Button size="sm" variant="light" color="blue" onClick={() => setEditing('new')}>
              ＋ New configuration
            </Button>
          </div>
        )}
      </Block>
      <Block head="Memory">
        <Row
          label="What Sky remembers about you"
          sub="A few facts kept between conversations, as files under ai/memory."
          last
        >
          {mono(`${data.memoryNotes} ${data.memoryNotes === 1 ? 'note' : 'notes'}`)}
          <Button size="sm" component="a" href="/explorer/ai/memory">
            View
          </Button>
        </Row>
      </Block>
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
  back,
}: {
  section: SettingsSection
  back: { label: string; onClick: () => void }
}) {
  const { data, note, change, reload } = useSettings()
  const label = SETTINGS_SECTIONS.find((candidate) => candidate.id === section)?.label ?? 'Settings'

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">{label}</span>
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-set">
          {note && <div className="sky-condensed">— {note} —</div>}
          {data &&
            (section === 'appearance' ? (
              <AppearancePane data={data} change={change} />
            ) : section === 'voice' ? (
              <VoicePane data={data} change={change} />
            ) : section === 'ai' ? (
              <AIPane data={data} reload={reload} />
            ) : section === 'notebook' ? (
              <NotebookPane data={data} change={change} />
            ) : section === 'advanced' ? (
              <AdvancedPane data={data} />
            ) : (
              <AboutPane data={data} />
            ))}
        </div>
      </div>
    </div>
  )
}
