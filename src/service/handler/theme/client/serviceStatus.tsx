/**
 * The service's own state, as the shell shows it: a restart waiting for
 * the machine to go quiet. A save under the service marks one pending; it
 * lands once nothing is running. The pill says so where the clock is, and
 * a click on it is the person saying "now".
 */

import { useEffect, useState } from 'react'

interface Status {
  pending: { since: number; reasons: string[]; files: string[] } | null
  holding: string[]
}

const POLL_MS = 5000

/** The service's restart status, read every few seconds; null while unknown or the service is away. */
export function useServiceStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    let alive = true
    const read = () => {
      fetch('/service/status')
        .then(async (response) => {
          if (!alive) return
          if (!response.ok) return setStatus(null)
          const body = (await response.json()) as { data?: Status }
          setStatus(body.data ?? null)
        })
        .catch(() => alive && setStatus(null))
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return status
}

/** "restart pending" while one waits, with what it waits on as the title; a click restarts now. */
export function RestartPending() {
  const status = useServiceStatus()
  if (!status?.pending) return null
  const waitingOn = status.holding.length > 0 ? `waiting on ${status.holding.join(', ')} — ` : ''
  return (
    <button
      type="button"
      className="sky-restart"
      title={`${waitingOn}click to restart now`}
      onClick={() => void fetch('/service/restart', { method: 'POST' }).catch(() => {})}
    >
      restart pending
    </button>
  )
}
