/**
 * Slack's own page under Connections: the workspace and Sky's recent checks
 * of it, the two marks in Slack and what they hold, and every channel Sky
 * keeps, each with a switch to leave it out. The row on the Connections page
 * leads here; connecting and recovery stay on that page.
 */

import { Button, TextInput } from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { saveSetting } from './settings.tsx'
import { Block, OnOff, plural, refusalOf, Row, sinceLabel } from './settingsBlocks.tsx'
import { ConnectionPage } from './settingsConnectionPage.tsx'
import { API, postJson, SlackRow } from './settingsConnections.tsx'
import { SlackCaptureAutomation } from './SlackCaptureAutomation.tsx'

// ── What the service answers (mirrors handler/settings/connections.ts) ──

type ChannelRow = { id: string; name: string; on: boolean; kept: number; lastPostEpoch?: number }

type PullRun = {
  at: string
  added: number
  channels: number
  threads: number
  read: number
  unchanged: number
  muted: number
  errors: number
  seconds: number
}

/** What lands in the day on its own; the keys under slack.forYou in the config */
type ForYou = { dms: boolean; mentions: boolean; own: boolean }

type ChannelsView = {
  forYou: ForYou
  joined: number
  muted: number
  kept: number
  days: number
  channels: ChannelRow[]
  runs: PullRun[]
}

type PullOutcome =
  | { ran: true; added: number; channels: number; threads: number; read: number; muted: number; errors: number }
  | { ran: false; reason: string }

type Marks = { todos: number; overdue: number; saved: number } | { unavailable: string }

/** Channels listed before Show all */
const SHOWN = 8
/** Recent checks listed */
const RUNS_SHOWN = 3

function useSlackPage() {
  const [view, setView] = useState<ChannelsView | null>(null)
  const [marks, setMarks] = useState<Marks | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch(`${API}/slack/channels`).catch(() => null)
    if (!r?.ok) {
      setWarn(await refusalOf(r))
      return
    }
    setWarn(null)
    setView((await r.json()) as ChannelsView)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  // The piles are asked of Slack itself, apart from the cache, so the page does not wait for them.
  useEffect(() => {
    let live = true
    void fetch(`${API}/slack/marks`)
      .catch(() => null)
      .then(async (r) => {
        const next: Marks = r?.ok
          ? ((await r.json()) as Marks)
          : { unavailable: (await refusalOf(r)) ?? 'Slack did not answer.' }
        if (live) setMarks(next)
      })
    return () => {
      live = false
    }
  }, [])

  const toggle = useCallback(
    async (id: string, on: boolean) => {
      // The row moves at once; the service's answer settles it.
      setView(
        (current) =>
          current && {
            ...current,
            muted: current.muted + (on ? -1 : 1),
            channels: current.channels.map((row) => (row.id === id ? { ...row, on } : row)),
          },
      )
      const refusal = await refusalOf(await postJson(`${API}/slack/channels/${encodeURIComponent(id)}`, { on }))
      if (refusal) setWarn(refusal)
      void reload()
    },
    [reload],
  )

  const rule = useCallback(
    async (key: keyof ForYou, on: boolean) => {
      // The switch moves at once; the file settles it, and the next pass reads it.
      setView((current) => current && { ...current, forYou: { ...current.forYou, [key]: on } })
      const refusal = await saveSetting(`slack.forYou.${key}`, String(on))
      if (refusal) setWarn(refusal)
      void reload()
    },
    [reload],
  )

  const check = useCallback(async () => {
    setBusy(true)
    setChecked(null)
    const r = await postJson(`${API}/slack/pull`, {})
    const refusal = await refusalOf(r)
    setBusy(false)
    if (refusal || !r) {
      setWarn(refusal)
      return
    }
    const outcome = (await r.json()) as PullOutcome
    setChecked(
      !outcome.ran
        ? outcome.reason
        : outcome.added > 0
          ? `${plural(outcome.added, 'message')} in ${plural(outcome.channels, 'channel')} kept.`
          : 'Nothing new.',
    )
    void reload()
  }, [reload])

  return { view, marks, warn, busy, checked, toggle, rule, check }
}

const FOR_YOU: { key: keyof ForYou; label: string; on: string; off: string }[] = [
  {
    key: 'dms',
    label: 'Direct messages',
    on: 'One-to-one and group messages land in the day as the conversation they came from, one document per day.',
    off: 'Off. Direct messages stay in Slack.',
  },
  {
    key: 'mentions',
    label: 'Mentions and thread replies',
    on: 'Anywhere you are named, and new replies in threads you are part of. The thread lands whole and keeps landing its replies.',
    off: 'Off. Mentions and replies stay in Slack.',
  },
  {
    key: 'own',
    label: 'Your own messages',
    on: 'What you sent lands too, so Sky can see what you already answered.',
    off: 'Off. What you sent is not kept unless someone answers.',
  },
]

function runHeadline(run: PullRun): string {
  return run.added > 0 ? `${plural(run.added, 'message')} in ${plural(run.channels, 'channel')}` : 'Nothing new'
}

function runLine(run: PullRun): string {
  const parts = [`${plural(run.read, 'channel')} read`, `${run.unchanged} unchanged`]
  if (run.threads > 0) parts.push(plural(run.threads, 'thread'))
  if (run.muted > 0) parts.push(`${plural(run.muted, 'muted channel')} left out`)
  if (run.errors > 0) parts.push(`${plural(run.errors, 'channel')} failed`)
  return parts.join(' · ')
}

/** Today as the pull stamps its runs, YYYY-MM-DD in this machine's time. */
function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A run's moment: the clock alone when it was today. */
export function runAt(at: string, today: string): string {
  return at.startsWith(today) ? at.slice(11) : at
}

export function channelSub(row: ChannelRow, now = Date.now()): string {
  if (!row.on) {
    return row.kept > 0
      ? `Muted. ${plural(row.kept, 'message')} kept before; nothing more is.`
      : 'Muted. Nothing from it is kept.'
  }
  if (row.kept === 0 || row.lastPostEpoch === undefined) return 'Quiet. Nothing kept yet.'
  return `${plural(row.kept, 'message')} kept · ${sinceLabel(row.lastPostEpoch * 1000, now).toLowerCase()}`
}

function markValue(marks: Marks | null, pick: (counted: { todos: number; overdue: number; saved: number }) => string) {
  if (!marks) return '…'
  return 'unavailable' in marks ? '—' : pick(marks)
}

export function SlackMain({ navigate }: { navigate: (to: string) => void }) {
  const { view, marks, warn, busy, checked, toggle, rule, check } = useSlackPage()
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const today = localToday()
  const needle = query.trim().replace(/^#/, '').toLowerCase()
  const shown = useMemo(() => {
    if (!view) return []
    const rows = needle ? view.channels.filter((row) => row.name.toLowerCase().includes(needle)) : view.channels
    return all || needle ? rows : rows.slice(0, SHOWN)
  }, [view, needle, all])

  return (
    <ConnectionPage
      name="Slack"
      gives="Slack carries your workspace. Sky keeps every channel you are in within reach, for its own reading and the day’s summary, and reads the two marks you put on messages."
      navigate={navigate}
    >
      {warn && (
        <p className="sky-set-warn" role="alert">
          {warn}
        </p>
      )}
      <Block
        head="Status"
        note="Sky reads Slack through your signed-in session and keeps its own place in every channel. Reading in Slack changes nothing here, and nothing is ever marked read. A check runs every five minutes."
      >
        <SlackRow navigate={navigate} onPage />
        {view &&
          (view.runs.length > 0 ? (
            <div className="sky-set-runs">
              {view.runs.slice(0, RUNS_SHOWN).map((run, index, runs) => (
                <div key={`${run.at} ${index}`} className="sky-set-run" data-last={index === runs.length - 1}>
                  <span className="sky-set-run-dot" data-tone={run.added > 0 ? 'done' : undefined} />
                  <div className="sky-set-run-txt">
                    {runHeadline(run)}
                    <span className="sky-set-run-line">{runLine(run)}</span>
                  </div>
                  <span className="sky-set-run-at">{runAt(run.at, today)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="sky-set-sub">No check has run yet. One runs every five minutes while the service is up.</p>
          ))}
        <div className="sky-set-actions">
          <Button size="sm" loading={busy} disabled={busy} onClick={() => void check()}>
            Check now
          </Button>
          {checked && <span role="status">{checked}</span>}
        </div>
      </Block>
      {view && (
        <Block
          head="For you"
          note="Lands in the day as the conversation it came from, on its own, within five minutes. Nothing here needs saving first, and nothing is written into the day file itself."
        >
          {FOR_YOU.map((entry, index) => (
            <Row
              key={entry.key}
              label={entry.label}
              sub={view.forYou[entry.key] ? entry.on : entry.off}
              last={index === FOR_YOU.length - 1}
            >
              <OnOff
                value={view.forYou[entry.key]}
                label={`Land ${entry.label.toLowerCase()}`}
                onChange={(on) => void rule(entry.key, on)}
              />
            </Row>
          ))}
        </Block>
      )}
      <SlackCaptureAutomation navigate={navigate} />
      <Block
        head="Marks in Slack"
        note="Two marks on a message, two meanings in Sky: a to-do is something to act on, saved is kept for context. sky slack:todos and sky slack:saved list them and bring them into the day."
      >
        <Row
          label={
            <>
              Add to-do
              <span className="sky-set-chips">
                <span className="sky-set-chip" data-tone="act">
                  Act
                </span>
              </span>
            </>
          }
          sub="Something that wants an action from you."
        >
          <span className="sky-set-value">
            {markValue(marks, (m) => `${m.todos} open${m.overdue ? ` · ${m.overdue} overdue` : ''}`)}
          </span>
        </Row>
        <Row
          label={
            <>
              Add to saved
              <span className="sky-set-chips">
                <span className="sky-set-chip" data-tone="keep">
                  Keep
                </span>
              </span>
            </>
          }
          sub="Kept for context. No task, nothing to answer."
          last
        >
          <span className="sky-set-value">{markValue(marks, (m) => `${m.saved} saved`)}</span>
        </Row>
        {marks && 'unavailable' in marks && <p className="sky-set-sub">{marks.unavailable}</p>}
      </Block>
      {view && (
        <Block
          head={
            <>
              Channels
              <span className="sky-set-count">
                {view.joined} joined{view.muted ? ` · ${view.muted} muted` : ''}
              </span>
            </>
          }
          note="Every channel you are in is kept for Sky to read and for the day’s summary, never written into your day. Mute a channel and nothing more from it is kept."
        >
          {view.channels.length > SHOWN && (
            <TextInput
              className="sky-set-find"
              size="sm"
              placeholder="Find a channel"
              aria-label="Find a channel"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          )}
          {shown.map((row, index) => (
            <Row
              key={row.id}
              label={
                <>
                  #{row.name}
                  {!row.on && (
                    <span className="sky-set-chips">
                      <span className="sky-set-chip" data-tone="muted">
                        Muted
                      </span>
                    </span>
                  )}
                </>
              }
              sub={channelSub(row)}
              last={index === shown.length - 1}
            >
              <OnOff value={row.on} label={`Keep #${row.name}`} onChange={(on) => void toggle(row.id, on)} />
            </Row>
          ))}
          {shown.length === 0 && (
            <p className="sky-set-sub">
              {view.channels.length
                ? 'No channel matches.'
                : 'No channels yet. The first check lists every channel you are in.'}
            </p>
          )}
          {!needle && view.channels.length > SHOWN && (
            <div className="sky-set-actions">
              <Button size="sm" onClick={() => setAll((open) => !open)}>
                {all ? 'Show fewer' : `Show all ${view.channels.length} channels`}
              </Button>
            </div>
          )}
        </Block>
      )}
    </ConnectionPage>
  )
}
