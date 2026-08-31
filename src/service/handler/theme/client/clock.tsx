import { Button, Loader, TextInput } from '@mantine/core'
import { Fragment, type KeyboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import './clock.css'

/**
 * The clock — notebook time against the world's.
 *
 * The ambient clock beside "sky" is the way in: one line while notebook
 * and system agree, a second orange line when they diverge. The page is
 * one input over one table. Typing filters the region list; a 500ms
 * pause sends the line to util:tz:convert when it reads like a question
 * or names a place the list doesn't know, and the answer lands as rows
 * in the same table. The client parses nothing — the model does the
 * reading on the service.
 *
 * Between fetches the clocks tick locally: the notebook day plus its
 * zone reproduce extended hours (32:07 the morning after an unstarted
 * day), and a refetch on focus or every few minutes picks up a
 * day:start done elsewhere.
 */

// -----------------------------------------------------------------------------
// What the service knows about the clocks
// -----------------------------------------------------------------------------

export interface ClockReading {
  /** `YYYY-MM-DD` — for the notebook, the day it is still on */
  date: string
  /** `HH:MM`; notebook hours may exceed 23 */
  time: string
  timezone: string
}

export interface ClockSnapshot {
  notebook: ClockReading
  system: ClockReading
}

export interface ConvertAnswer {
  local: ClockReading
  target: ClockReading
  utc: ClockReading
}

/** The snapshot, refreshed on focus and every few minutes. */
export function useClockNow(): ClockSnapshot | null {
  const [snap, setSnap] = useState<ClockSnapshot | null>(null)
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/clock/_api/now')
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => alive && body && setSnap(body as ClockSnapshot))
        .catch(() => {})
    void read()
    window.addEventListener('focus', read)
    const timer = setInterval(read, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [])
  return snap
}

// -----------------------------------------------------------------------------
// Clock arithmetic — Intl only, minute precision
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

interface ZoneParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  wd: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

function partsIn(at: Date, tz: string): ZoneParts {
  const o: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(at)) o[part.type] = part.value
  return { y: +o.year!, mo: +o.month!, d: +o.day!, h: +o.hour! % 24, mi: +o.minute!, wd: o.weekday! }
}

function offsetMinutes(at: Date, tz: string): number {
  const t = Math.floor(at.getTime() / 60_000) * 60_000
  const p = partsIn(new Date(t), tz)
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t) / 60_000)
}

function offsetLabel(min: number): string {
  const abs = Math.abs(min)
  return `${min < 0 ? '−' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`
}

function relDayOf(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `+${days} days` : `${days} days`
}

function relDay(p: { y: number; mo: number; d: number }, anchor: ZoneParts): string {
  return relDayOf(Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(anchor.y, anchor.mo - 1, anchor.d)) / DAY_MS))
}

function ymdParts(ymd: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = ymd.split('-').map(Number)
  return { y: y ?? 1970, mo: mo ?? 1, d: d ?? 1 }
}

const weekdays = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
function weekdayOf(ymd: string): string {
  const { y, mo, d } = ymdParts(ymd)
  return weekdays.format(new Date(Date.UTC(y, mo - 1, d)))
}

/** Whole days from the notebook's day to the calendar date now in its zone. */
function daysSince(ymd: string, p: ZoneParts): number {
  const { y, mo, d } = ymdParts(ymd)
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(y, mo - 1, d)) / DAY_MS)
}

/** The zone's next clock change within a year — `−1h Oct 25`, '' for zones that never shift. */
const changes = new Map<string, string>()
function changeLabel(tz: string, from: Date): string {
  const key = `${tz}:${Math.floor(from.getTime() / DAY_MS)}`
  const cached = changes.get(key)
  if (cached !== undefined) return cached
  const base = offsetMinutes(from, tz)
  let label = ''
  for (let day = 1; day <= 370; day++) {
    const at = new Date(from.getTime() + day * DAY_MS)
    const offset = offsetMinutes(at, tz)
    if (offset === base) continue
    // Narrow the flip to the hour, in that zone's own terms.
    let before = new Date(at.getTime() - DAY_MS)
    let after = at
    for (let i = 0; i < 14; i++) {
      const mid = new Date((before.getTime() + after.getTime()) / 2)
      if (offsetMinutes(mid, tz) === base) before = mid
      else after = mid
    }
    const when = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(after)
    const delta = (offset - base) / 60
    label = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}h ${when}`
    break
  }
  changes.set(key, label)
  return label
}

interface LiveNotebook {
  /** `32:07` when the day has run past midnight un-started */
  time: string
  /** The notebook day's weekday */
  wd: string
  extended: boolean
}

function liveNotebook(snap: ClockSnapshot, at: Date): LiveNotebook {
  const p = partsIn(at, snap.notebook.timezone)
  const gap = Math.max(0, daysSince(snap.notebook.date, p))
  return { time: `${pad(p.h + 24 * gap)}:${pad(p.mi)}`, wd: weekdayOf(snap.notebook.date), extended: gap > 0 }
}

/** Re-render once a minute so the displayed clocks stay true. */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 60_000)
      setMinute((prev) => (prev === now ? prev : now))
    }, 5_000)
    return () => clearInterval(timer)
  }, [])
  return minute
}

// -----------------------------------------------------------------------------
// 24-hour or am/pm — one preference for every clock on the page
// -----------------------------------------------------------------------------

const HOUR12_KEY = 'sky-clock-hour12'
function readHour12(): boolean {
  try {
    return localStorage.getItem(HOUR12_KEY) === '1'
  } catch {
    // A private window keeps the default.
    return false
  }
}
let hour12Now = readHour12()
const hour12Subs = new Set<() => void>()
function setHour12(next: boolean) {
  hour12Now = next
  try {
    localStorage.setItem(HOUR12_KEY, next ? '1' : '0')
  } catch {
    // A private window forgets; the toggle still works for the page.
  }
  for (const sub of hour12Subs) sub()
}
function useHour12(): boolean {
  return useSyncExternalStore(
    (cb) => {
      hour12Subs.add(cb)
      return () => hour12Subs.delete(cb)
    },
    () => hour12Now,
  )
}

/** `14:46` as asked — extended notebook hours have no am/pm form and stay as filed. */
function fmtClock(time: string, hour12: boolean): { main: string; suffix?: string } {
  if (!hour12) return { main: time }
  const [h, mi] = time.split(':').map(Number)
  if (h === undefined || mi === undefined || Number.isNaN(h) || Number.isNaN(mi) || h >= 24) return { main: time }
  return { main: `${h % 12 === 0 ? 12 : h % 12}:${pad(mi)}`, suffix: h < 12 ? 'am' : 'pm' }
}

function clockText(time: string, hour12: boolean): string {
  const shown = fmtClock(time, hour12)
  return shown.suffix ? `${shown.main} ${shown.suffix}` : shown.main
}

// -----------------------------------------------------------------------------
// The common regions — a fixed set for now; see this handler's docs before growing it
// -----------------------------------------------------------------------------

interface Region {
  name: string
  tz: string
  /** What a filter may call it besides the name */
  aliases: string[]
}

const REGIONS: Region[] = [
  { name: 'San Francisco', tz: 'America/Los_Angeles', aliases: ['sf', 'los angeles', 'pacific'] },
  { name: 'New York', tz: 'America/New_York', aliases: ['nyc', 'ny', 'eastern'] },
  { name: 'Buenos Aires', tz: 'America/Argentina/Buenos_Aires', aliases: ['ba', 'argentina'] },
  { name: 'London', tz: 'Europe/London', aliases: ['uk'] },
  { name: 'Berlin', tz: 'Europe/Berlin', aliases: ['germany', 'cet'] },
  { name: 'Dubai', tz: 'Asia/Dubai', aliases: ['uae'] },
  { name: 'India', tz: 'Asia/Kolkata', aliases: ['mumbai', 'delhi', 'bangalore', 'ist'] },
  { name: 'Singapore', tz: 'Asia/Singapore', aliases: ['sg'] },
  { name: 'Hong Kong', tz: 'Asia/Hong_Kong', aliases: ['hk'] },
  { name: 'Tokyo', tz: 'Asia/Tokyo', aliases: ['japan'] },
  { name: 'Sydney', tz: 'Australia/Sydney', aliases: ['australia'] },
  { name: 'Auckland', tz: 'Pacific/Auckland', aliases: ['nz', 'new zealand'] },
]

/** A friendly name for a zone: the region's, else the IANA city segment. */
function zoneName(tz: string): string {
  return REGIONS.find((region) => region.tz === tz)?.name ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
}

/** The regions a line narrows to — a convert-looking line filters by its trailing "in <place>". */
function matchRegions(text: string, at: Date): Region[] {
  const raw = text.trim().toLowerCase()
  const fragment = raw.replace(/^.*\bin\s+/, '').trim() || raw
  return REGIONS.filter(
    (region) =>
      !fragment ||
      region.name.toLowerCase().includes(fragment) ||
      region.tz.toLowerCase().includes(fragment) ||
      region.aliases.some((alias) => alias.includes(fragment)) ||
      offsetLabel(offsetMinutes(at, region.tz)).includes(fragment),
  ).toSorted((a, b) => offsetMinutes(at, a.tz) - offsetMinutes(at, b.tz))
}

/** Whether the line asks for a conversion rather than narrowing the list. */
function asksATime(text: string): boolean {
  return /\d/.test(text) || /\b(now|today|tomorrow|yesterday|noon|midnight|am|pm|in)\b/i.test(text)
}

// -----------------------------------------------------------------------------
// The ambient clock beside the brand — the way into /clock
// -----------------------------------------------------------------------------

export function ClockAmbient({
  snap,
  active,
  onOpen,
}: {
  snap: ClockSnapshot | null
  active: boolean
  onOpen: () => void
}) {
  useMinute()
  const hour12 = useHour12()
  if (!snap) return null
  const at = new Date()
  const notebook = liveNotebook(snap, at)
  const system = partsIn(at, snap.system.timezone)
  const agree = !notebook.extended && snap.notebook.timezone === snap.system.timezone
  const sysTime = clockText(`${pad(system.h)}:${pad(system.mi)}`, hour12)
  return (
    <button type="button" className="sky-ambient" data-active={active} onClick={onOpen} aria-label="Open the clock">
      <b>{clockText(notebook.time, hour12)}</b> {notebook.wd}
      {!agree && (
        <>
          {' · notebook'}
          <br />
          <span className="sky-ambient-warn">
            {sysTime} {system.wd} · system
          </span>
        </>
      )}
    </button>
  )
}

// -----------------------------------------------------------------------------
// The page — one input, one table
// -----------------------------------------------------------------------------

type Tone = 'plain' | 'pinned' | 'answer' | 'warn'

function Row({
  time,
  name,
  zone,
  rel,
  offset,
  change,
  tone = 'plain',
}: {
  time: string
  name: string
  zone?: string
  rel: string
  offset: string
  change: string
  tone?: Tone
}) {
  const hour12 = useHour12()
  const shown = fmtClock(time, hour12)
  return (
    <div className="sky-clock-row" data-tone={tone}>
      <span className="sky-clock-time">
        {shown.main}
        {shown.suffix && <span className="sky-clock-ampm">{shown.suffix}</span>}
      </span>
      <span className="sky-clock-name">
        {name}
        {zone && zone !== name && <span className="sky-clock-zone">{zone}</span>}
      </span>
      <span className="sky-clock-rel">{rel}</span>
      <span className="sky-clock-off">{offset}</span>
      <span className="sky-clock-chg">{change}</span>
    </div>
  )
}

interface Asked {
  query: string
  answer?: ConvertAnswer
  error?: string
}

/** The converted instant's rows, in the table's own columns. */
function AnswerRows({ answer, anchor }: { answer: ConvertAnswer; anchor: ZoneParts }) {
  // The UTC row names the instant; offsets and clock changes resolve against it.
  const u = ymdParts(answer.utc.date)
  const [hh, mm] = answer.utc.time.split(':').map(Number)
  const instant = new Date(Date.UTC(u.y, u.mo - 1, u.d, hh ?? 0, mm ?? 0))
  const nowish = Math.abs(instant.getTime() - Date.now()) < 90_000
  const row = (reading: ClockReading, name: string, tone: Tone) => (
    <Row
      time={reading.time}
      name={name}
      zone={zoneName(reading.timezone)}
      rel={relDay(ymdParts(reading.date), anchor)}
      offset={offsetLabel(offsetMinutes(instant, reading.timezone))}
      change={changeLabel(reading.timezone, instant)}
      tone={tone}
    />
  )
  // Asked about now, the answer is one clock; asked about another moment,
  // the local and UTC readings of the same instant come along.
  return (
    <div className="sky-clock-group" data-kind="answer">
      {!nowish && row(answer.local, 'Local', 'plain')}
      {row(answer.target, zoneName(answer.target.timezone), 'answer')}
      {!nowish && row(answer.utc, 'UTC', 'plain')}
    </div>
  )
}

export function ClockMain({
  back,
  snap,
}: {
  back: { label: string; onClick: () => void }
  snap: ClockSnapshot | null
}) {
  useMinute()
  const hour12 = useHour12()
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState<Asked | null>(null)
  const [busy, setBusy] = useState(false)

  const cache = useRef(new Map<string, ConvertAnswer>())
  const inflight = useRef<AbortController | null>(null)
  const current = useRef('')

  const send = useCallback((query: string) => {
    current.current = query
    inflight.current?.abort()
    const hit = cache.current.get(query)
    if (hit) {
      setBusy(false)
      setAsked({ query, answer: hit })
      return
    }
    const controller = new AbortController()
    inflight.current = controller
    setBusy(true)
    fetch('/clock/_api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as ConvertAnswer & { message?: string }
        if (current.current !== query) return
        setBusy(false)
        if (!r.ok) {
          setAsked({ query, error: body.message ?? `The service answered ${r.status}.` })
          return
        }
        cache.current.set(query, body)
        setAsked({ query, answer: body })
      })
      .catch(() => {
        if (controller.signal.aborted || current.current !== query) return
        setBusy(false)
        setAsked({ query, error: "Couldn't reach sky — is the service running?" })
      })
  }, [])

  // A pause asks on its own — when the line reads like a question, or names
  // a place the list doesn't know. A bare filter never spends a model call.
  useEffect(() => {
    const query = q.trim()
    const wants = query && (asksATime(query) || matchRegions(query, new Date()).length === 0)
    if (!wants) {
      current.current = ''
      inflight.current?.abort()
      setBusy(false)
      setAsked(null)
      return
    }
    if (current.current === query) return
    const timer = setTimeout(() => send(query), 500)
    return () => clearTimeout(timer)
  }, [q, send])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (q.trim()) send(q.trim())
    } else if (event.key === 'Escape') {
      setQ('')
    }
  }

  const at = new Date()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const anchor = partsIn(at, snap?.system.timezone ?? browserTz)
  const matches = matchRegions(q, at)
  // A bare place the list knows is answered by its own row, no model needed.
  const picked = q.trim() && !asksATime(q) && matches.length === 1 ? matches[0] : null

  const notebook = snap ? liveNotebook(snap, at) : null
  const system = snap ? partsIn(at, snap.system.timezone) : null
  const utc = partsIn(at, 'UTC')
  const moved = snap ? snap.notebook.timezone !== snap.system.timezone : false
  const causes: string[] = []
  if (notebook?.extended) {
    causes.push(`The day is not started — the notebook is still on ${notebook.wd} at ${notebook.time}.`)
  }
  if (snap && moved) {
    causes.push(`The machine is in ${snap.system.timezone}; the notebook day was started in ${snap.notebook.timezone}.`)
  }

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">Clock</span>
        {snap && (
          <span className="sky-mini">
            {snap.notebook.timezone} · {offsetLabel(offsetMinutes(at, snap.notebook.timezone))}
          </span>
        )}
      </header>

      <div className="sky-scroll">
        <div className="sky-col sky-clock">
          <section className="sky-block">
            <div className="sky-block-pad">
              <TextInput
                size="md"
                value={q}
                onChange={(event) => setQ(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                placeholder="Filter, or ask — 3pm tomorrow in Hong Kong"
                aria-label="Filter regions or ask a time question"
                rightSection={busy ? <Loader size="xs" /> : undefined}
                autoFocus
              />
              <p className="sky-clock-hint">
                Type to narrow the list, or ask a time — “3pm tomorrow in Hong Kong”, “in 3 hours in London” — and the
                answer appears as you pause.
              </p>

              <div className="sky-clock-table" data-busy={busy}>
                <div className="sky-clock-row" data-head="true">
                  <button
                    type="button"
                    className="sky-clock-h sky-clock-htoggle"
                    onClick={() => setHour12(!hour12)}
                    title={hour12 ? 'Switch to 24-hour' : 'Switch to am/pm'}
                    aria-pressed={hour12}
                  >
                    Time <span className="sky-clock-hmode">{hour12 ? 'am/pm' : '24h'}</span>
                  </button>
                  <span className="sky-clock-h">Place</span>
                  <span className="sky-clock-h">Day</span>
                  <span className="sky-clock-h sky-clock-h-right">Offset</span>
                  <span className="sky-clock-h sky-clock-h-right sky-clock-chg">DST</span>
                </div>
                {asked?.error && <div className="sky-condensed">— {asked.error} —</div>}
                {asked?.answer && <AnswerRows answer={asked.answer} anchor={anchor} />}

                {snap && notebook && system ? (
                  <>
                    <div className="sky-clock-group" data-kind="pinned">
                      <Row
                        time={notebook.time}
                        name="Notebook"
                        zone={zoneName(snap.notebook.timezone)}
                        rel={relDay(ymdParts(snap.notebook.date), anchor)}
                        offset={offsetLabel(offsetMinutes(at, snap.notebook.timezone))}
                        change={changeLabel(snap.notebook.timezone, at)}
                        tone="pinned"
                      />
                      {causes.length > 0 && (
                        <Row
                          time={`${pad(system.h)}:${pad(system.mi)}`}
                          name="System"
                          zone={zoneName(snap.system.timezone)}
                          rel="today"
                          offset={offsetLabel(offsetMinutes(at, snap.system.timezone))}
                          change={changeLabel(snap.system.timezone, at)}
                          tone="warn"
                        />
                      )}
                      <Row
                        time={`${pad(utc.h)}:${pad(utc.mi)}`}
                        name="UTC"
                        rel={relDay(utc, anchor)}
                        offset="+0"
                        change=""
                        tone="pinned"
                      />
                    </div>
                    {causes.map((cause) => (
                      <p key={cause} className="sky-clock-cause">
                        {cause}
                      </p>
                    ))}
                  </>
                ) : (
                  <div className="sky-condensed">— Couldn't reach sky — is the service running? —</div>
                )}

                <div className="sky-clock-list">
                  {matches.map((region) => {
                    const p = partsIn(at, region.tz)
                    return (
                      <Fragment key={region.tz}>
                        <Row
                          tone={picked?.tz === region.tz ? 'answer' : 'plain'}
                          time={`${pad(p.h)}:${pad(p.mi)}`}
                          name={region.name}
                          rel={relDay(p, anchor)}
                          offset={offsetLabel(offsetMinutes(at, region.tz))}
                          change={changeLabel(region.tz, at)}
                        />
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
