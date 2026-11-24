import { Button } from '@mantine/core'
import { useState } from 'react'
import type { WizardSummary } from '#lib/decisionWizard/session.ts'
import type { FutureDecision } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { FutureLink } from './FutureLink.tsx'
import { Mark } from './Mark.tsx'
import { wizardHref } from './routes.ts'
import { TieLink } from './TieLink.tsx'
import { listed } from './words.ts'

const TITLE: Record<FutureDecision['state'], string> = { open: 'To decide', inForce: 'In force', decided: 'Decided' }
const STANDS: Record<WizardSummary['status'], string> = {
  thinking: 'Sky is thinking it through',
  ready: 'Ready to pick up',
  failed: 'Sky could not finish thinking',
}

/**
 * The decisions that still ask something of the person: the ones being worked
 * through in the wizard, the open ones and the ones in force. The ones already
 * made and carried out are history, so they stay out of the way until asked for.
 */
export function DecisionsList({
  decisions,
  wizards,
  today,
  navigate,
  onAdd,
  onDiscard,
}: {
  decisions: FutureDecision[]
  /** Wizard runs that were started and not finished */
  wizards: WizardSummary[]
  today: string
  navigate: (to: string) => void
  onAdd: () => void
  onDiscard: (id: string) => Promise<void>
}) {
  const [showDecided, setShowDecided] = useState(false)
  const [discarding, setDiscarding] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const discard = async (id: string) => {
    setBusy(true)
    setProblem('')
    try {
      await onDiscard(id)
      setDiscarding(null)
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // A run saved as open is listed as that open decision; the rest are not in the notebook yet.
  const unfinished = wizards.filter((wizard) => !wizard.open)
  if (!decisions.length && !unfinished.length)
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
          {rows.map((decision) => {
            const run = wizards.find((wizard) => wizard.open === decision.name)
            return (
              <div className="sky-future-row" key={decision.file}>
                <span>
                  <TieLink
                    kind="decision"
                    name={decision.name}
                    title={decision.title}
                    file={decision.file}
                    navigate={navigate}
                  />
                  {run && (
                    <FutureLink
                      to={wizardHref(run.id)}
                      navigate={navigate}
                      className="sky-future-text-link sky-future-row-action"
                    >
                      Pick up where you stopped
                    </FutureLink>
                  )}
                  <span className="sky-future-under">
                    {decision.goals.length
                      ? `Weighs on ${listed(decision.goals.map((goal) => goal.title))}`
                      : 'Not tied to a goal'}
                  </span>
                </span>
                {when(decision) && <span className="sky-future-meta">{when(decision)}</span>}
              </div>
            )
          })}
        </div>
      </section>
    )
  }
  const decided = decisions.filter((decision) => decision.state === 'decided').length
  return (
    <>
      {unfinished.length > 0 && (
        <section className="sky-future-section" aria-labelledby="sky-future-decisions-unfinished">
          <h2 id="sky-future-decisions-unfinished">
            Being worked through<small>{unfinished.length}</small>
          </h2>
          <div className="sky-future-rows">
            {unfinished.map((wizard) => (
              <div className="sky-future-row" key={wizard.id}>
                <span>
                  <FutureLink to={wizardHref(wizard.id)} navigate={navigate} className="sky-future-item">
                    <Mark kind="decision" />
                    <span>{wizard.title}</span>
                  </FutureLink>
                  {discarding !== wizard.id && (
                    <button
                      type="button"
                      className="sky-future-remove sky-future-row-action"
                      onClick={() => {
                        setProblem('')
                        setDiscarding(wizard.id)
                      }}
                    >
                      Discard
                    </button>
                  )}
                  <span className="sky-future-under">Not in your notebook yet. It is saved when you finish.</span>
                  {discarding === wizard.id && (
                    <span className="sky-future-row-confirm" role="group" aria-label={`Discard “${wizard.title}”?`}>
                      <span>{problem || 'Discard this? Sky’s thinking and your answers so far are deleted.'}</span>
                      <Button
                        variant="danger-quiet"
                        size="compact-sm"
                        loading={busy}
                        onClick={() => void discard(wizard.id)}
                      >
                        Discard
                      </Button>
                      <Button size="compact-sm" disabled={busy} onClick={() => setDiscarding(null)}>
                        Keep it
                      </Button>
                    </span>
                  )}
                </span>
                <span className="sky-future-meta">{STANDS[wizard.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {decided === decisions.length && !unfinished.length && (
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
