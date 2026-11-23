import { Button } from '@mantine/core'
import { useState } from 'react'
import type { FutureDecision } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { TieLink } from './TieLink.tsx'
import { listed } from './words.ts'

const TITLE: Record<FutureDecision['state'], string> = { open: 'To decide', inForce: 'In force', decided: 'Decided' }

/**
 * The decisions that still ask something of the person: the open ones and the
 * ones in force. The ones already made and carried out are history, so they
 * stay out of the way until asked for.
 */
export function DecisionsList({
  decisions,
  today,
  navigate,
  onAdd,
}: {
  decisions: FutureDecision[]
  today: string
  navigate: (to: string) => void
  onAdd: () => void
}) {
  const [showDecided, setShowDecided] = useState(false)
  if (!decisions.length)
    return (
      <div className="sky-future-empty">
        <h2>No decisions yet</h2>
        <p>
          Write down a decision you are facing, or one you have made. Sky keeps the open ones and the ones in force in
          view in every chat.
        </p>
        <Button variant="primary" onClick={onAdd}>
          ＋ Add a decision
        </Button>
      </div>
    )
  const when = (decision: FutureDecision): string | null => {
    const since = decision.since ? niceDate(decision.since, today) : null
    if (decision.state === 'open')
      return decision.target ? `Decide by ${niceDate(decision.target, today)}` : since && `Open since ${since}`
    return since && (decision.state === 'inForce' ? `Since ${since}` : `Decided ${since}`)
  }
  const group = (state: FutureDecision['state']) => {
    const rows = decisions.filter((decision) => decision.state === state)
    if (!rows.length) return null
    return (
      <section className="sky-future-section" aria-labelledby={`sky-future-decisions-${state}`}>
        <h2 id={`sky-future-decisions-${state}`}>
          {TITLE[state]}
          <small>{rows.length}</small>
        </h2>
        <div className="sky-future-rows">
          {rows.map((decision) => (
            <div className="sky-future-row" key={decision.file}>
              <span>
                <TieLink
                  kind="decision"
                  name={decision.name}
                  title={decision.title}
                  file={decision.file}
                  navigate={navigate}
                />
                <span className="sky-future-under">
                  {decision.goals.length
                    ? `Weighs on ${listed(decision.goals.map((goal) => goal.title))}`
                    : 'Not tied to a goal'}
                </span>
              </span>
              {when(decision) && <span className="sky-future-meta">{when(decision)}</span>}
            </div>
          ))}
        </div>
      </section>
    )
  }
  const decided = decisions.filter((decision) => decision.state === 'decided').length
  return (
    <>
      {decided === decisions.length && (
        <p className="sky-future-hint sky-future-quiet">Nothing to decide, and nothing in force.</p>
      )}
      {group('open')}
      {group('inForce')}
      {decided > 0 && (
        <p className="sky-future-more">
          <button
            type="button"
            className="sky-showlink"
            aria-expanded={showDecided}
            onClick={() => setShowDecided((shown) => !shown)}
          >
            {showDecided ? 'Hide decided' : `Show ${decided} decided`}
          </button>
        </p>
      )}
      {showDecided && group('decided')}
    </>
  )
}
