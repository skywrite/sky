import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { WizardSession } from '#lib/decisionWizard/session.ts'

const STEPS = ['reading', 'thinking', 'writing'] as const
const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The one long wait. Sky thinks the decision through once, in the background,
 * and the page says what it is doing and for how long. The person can leave:
 * the run keeps going and waits under Decisions.
 */
export function Thinking({
  run,
  onRetry,
  onDiscard,
}: {
  run: WizardSession
  onRetry: () => void
  onDiscard: () => void
}) {
  const [now, setNow] = useState(() => performance.timeOrigin + performance.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.timeOrigin + performance.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (run.status === 'failed')
    return (
      <>
        <h2>Sky could not finish thinking</h2>
        <p className="sky-wizard-lede">{run.error ?? 'Something went wrong while Sky was thinking this through.'}</p>
        <p className="sky-wizard-note">Nothing was saved to your notebook. Starting again takes several minutes.</p>
        <div className="sky-wizard-actions">
          <Button onClick={onDiscard}>Discard</Button>
          <Button variant="primary" onClick={onRetry}>
            Start the thinking again
          </Button>
        </div>
      </>
    )
  const at = STEPS.indexOf(run.stage ?? 'reading')
  const read = run.read
  const labels = [
    read
      ? `Read what bears on this: ${read.goals} goal${read.goals === 1 ? '' : 's'}, ${read.inForce} decision${read.inForce === 1 ? '' : 's'} in force, ${read.notes} note${read.notes === 1 ? '' : 's'}`
      : 'Reading what bears on this in your notebook',
    'Thinking it through at full effort',
    'Writing up what you will be asked',
  ]
  return (
    <>
      <h2>Sky is thinking this through</h2>
      <p className="sky-wizard-lede">
        This is the one long wait. Sky thinks it through once, at full effort, so every step after this is instant. It
        can take {run.decided ? '5 to 10' : '10 to 15'} minutes.
      </p>
      <div className="sky-wizard-wait">
        {run.since !== null && (
          <div className="sky-wizard-clock" role="timer">
            {clock(now - run.since)}
            <small>so far</small>
          </div>
        )}
        <ol className="sky-wizard-think" role="status">
          {labels.map((label, n) => (
            <li key={label} data-state={n < at ? 'done' : n === at ? 'now' : undefined}>
              <i aria-hidden="true" />
              {label}
            </li>
          ))}
        </ol>
      </div>
      <div className="sky-wizard-read">
        <h3>You can leave this page</h3>
        <p>
          Sky keeps going. The decision waits for you on the Decisions list, and this tab’s title changes when it is
          ready.
        </p>
      </div>
    </>
  )
}
