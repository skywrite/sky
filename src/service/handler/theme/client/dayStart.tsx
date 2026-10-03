import './dayStart.css'
import { Button } from '@mantine/core'
import { useState } from 'react'
import type { DayData, DayDue } from './day.tsx'

/**
 * Starting the day that is waiting. Once the notebook clock has run past
 * 24:00, the calendar's day can begin, and the pages say so where the
 * person already is: the open day's page whispers it in the status line
 * until 4 am and carries a block at the top after that; the waiting day's
 * own page has Start beside its count. Pressing Start runs the terminal's
 * day:start at that moment, exactly as the week page does.
 */

/** The sidebar's sun, small enough for a status line. */
export function SunIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

/** Runs day:start for the day and answers with its fresh view, or the reason it did not land. */
async function start(ymd: string): Promise<{ view: DayData | null; error: string | null }> {
  try {
    const response = await fetch(`/day/${ymd}/start`, { method: 'POST' })
    const json = (await response.json().catch(() => null)) as (DayData & { error?: string; view?: DayData }) | null
    if (!response.ok || !json || json.error)
      return { view: json?.view ?? null, error: json?.error ?? `That did not go through (${response.status}).` }
    return { view: json, error: null }
  } catch {
    return { view: null, error: 'The service did not answer.' }
  }
}

/** One press at a time: busy while day:start runs, and the reason when it did not finish. */
export function useStartDay(onStarted: (view: DayData) => void): {
  busy: boolean
  error: string | null
  run: (ymd: string) => Promise<void>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (ymd: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await start(ymd)
    setBusy(false)
    if (result.error) return setError(result.error)
    if (result.view) onStarted(result.view)
  }
  return { busy, error, run }
}

interface StartProps {
  due: DayDue
  busy: boolean
  error: string | null
  onStart: () => void
}

/** `Friday, September 27` — the label without its year. */
const monthDay = (dateLabel: string) => dateLabel.replace(/, \d{4}$/, '')

/** Past midnight, still the open day: one quiet line under the status, with Start a whisper away. */
export function NightStartLine({ today, due, busy, error, onStart }: StartProps & { today: string }) {
  return (
    <div className="sky-day-statusline" data-start="night">
      <span>
        Past midnight. Still {today} until you start {due.weekday}
      </span>
      <span aria-hidden="true">·</span>
      <Button size="compact-sm" leftSection={<SunIcon />} loading={busy} onClick={onStart}>
        Start {due.weekday}
      </Button>
      {error && (
        <span className="sky-day-start-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

/** The morning: the calendar's day has come, and the page's one primary button starts it. */
export function NextDayBlock({ today, due, busy, error, onStart }: StartProps & { today: string }) {
  return (
    <div className="sky-day-start" data-start="morning">
      <div className="sky-day-start-words">
        <div className="sky-day-start-lead">It’s {monthDay(due.dateLabel)}.</div>
        <div className="sky-day-start-sub">
          You’re still on {today}. Anything you add goes there until you start {due.weekday}.
        </div>
        {error && (
          <div className="sky-day-start-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <Button variant="primary" loading={busy} onClick={onStart}>
        Start {due.weekday}
      </Button>
    </div>
  )
}

/** On the waiting day's own page: Start beside its count, the way End sits beside a past day's. */
export function StartButton({ due, busy, onStart }: Omit<StartProps, 'error'>) {
  return (
    <Button variant="primary" size="compact-sm" leftSection={<SunIcon />} loading={busy} onClick={onStart}>
      Start {due.weekday}
    </Button>
  )
}
