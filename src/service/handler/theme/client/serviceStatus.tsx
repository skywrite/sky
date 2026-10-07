/**
 * The service's own state, as the shell shows it: a restart waiting for
 * the machine to go quiet. A save under the service marks one pending; it
 * lands once nothing is running. The sidebar names what it waits for, and
 * Restart now lets the person cut the wait short.
 */

import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'

interface Status {
  pending: { since: number; reasons: string[]; files: string[] } | null
  holding: string[]
}

const POLL_MS = 5000
const ACTIVITY_LABELS: Record<string, string> = {
  boot: 'startup',
  heartbeat: 'background checks',
  import: 'file import',
  'chat turn': 'chat reply',
  voice: 'voice conversation',
}

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

/** Show the current wait beside an explicit action to restart now. */
export function RestartPending() {
  const status = useServiceStatus()
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!status?.pending) {
      setRestarting(false)
      setError(null)
    }
  }, [status?.pending])

  const restart = async () => {
    setRestarting(true)
    setError(null)
    try {
      const response = await fetch('/service/restart', { method: 'POST' })
      if (!response.ok) throw new Error('Could not restart Sky. Try again.')
    } catch {
      setError('Could not restart Sky. Try again.')
      setRestarting(false)
    }
  }

  if (!status?.pending) return null
  const waitingOn = [...new Set(status.holding)].map((label) => ACTIVITY_LABELS[label] ?? label).join(', ')
  return (
    <div className="sky-restart">
      <div role="status">
        <div className="sky-restart-label">Restart pending</div>
        <div className="sky-restart-waiting">{waitingOn ? `Waiting for ${waitingOn}` : 'Restarting shortly'}</div>
      </div>
      <Button variant="primary-quiet" size="compact-sm" loading={restarting} onClick={() => void restart()}>
        {restarting ? 'Restarting…' : 'Restart now'}
      </Button>
      {error && <div role="alert">{error}</div>}
    </div>
  )
}
