import { Button } from '@mantine/core'
import { useEffect } from 'react'
import type { FutureDecisionDetail } from '../../../service/handler/future/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { RenderedHtml } from '../lib/renderedHtml.tsx'
import { niceDate } from './dates.ts'
import { FutureLink } from './FutureLink.tsx'
import { decisionHref, wizardHref } from './routes.ts'
import { weighingSummary } from './tally.ts'
import { TieLink } from './TieLink.tsx'
import { useDecision } from './useDecision.ts'
import { Weighing } from './Weighing.tsx'
import { talkItThrough } from './wizard/talk.ts'
import './DecisionPage.css'

const STATE: Record<FutureDecisionDetail['state'], string> = { open: 'Open', inForce: 'In force', decided: 'Decided' }
/**
 * One decision's own page. For a decision worked through in the wizard it
 * shows how the options stand against what the person wants; for any decision
 * it shows where it stands, its record as its file holds it, and what it is
 * tied to.
 */
export function DecisionPage({
  name,
  navigate,
  onTitle,
}: {
  name: string
  navigate: (to: string) => void
  /** The tab names the decision that is open */
  onTitle: (title: string) => void
}) {
  const { view, missing } = useDecision(name)
  const title = view?.decision.title
  useEffect(() => {
    onTitle(title ?? 'Decision')
  }, [onTitle, title])

  const crumbs = (
    <nav className="sky-future-crumbs" aria-label="Breadcrumb">
      <FutureLink to="/future" navigate={navigate}>
        Future
      </FutureLink>
      <span aria-hidden="true">›</span>
      <FutureLink to="/future/decisions" navigate={navigate}>
        Decisions
      </FutureLink>
    </nav>
  )
  if (!view)
    return (
      <>
        {crumbs}
        {missing ? (
          <div className="sky-future-empty">
            <h2>This decision isn’t here</h2>
            <p>{missing}</p>
            <Button variant="primary" onClick={() => navigate('/future/decisions')}>
              See your decisions
            </Button>
          </div>
        ) : (
          <p className="sky-future-hint" role="status">
            Loading this decision…
          </p>
        )}
      </>
    )

  const { decision, weighing, today } = view
  const since = decision.since ? niceDate(decision.since, today) : null
  const stands =
    decision.state === 'open'
      ? decision.target
        ? `Decide by ${niceDate(decision.target, today)}`
        : since
          ? `Open since ${since}`
          : 'No day to decide by'
      : since
        ? `${decision.state === 'inForce' ? 'In force since' : 'Decided'} ${since}`
        : null
  const run = weighing?.run ?? null
  // The bigger question this decision is one answer to: the wordings Sky gave that are wider than the one kept.
  const frames = weighing?.plan.frames ?? []
  const kept = weighing ? (weighing.answers.frame ?? frames.findIndex((frame) => frame.title === decision.title)) : -1
  const wider = frames.filter((frame, at) => at > kept && frame.title !== decision.title)
  const summary = weighing ? weighingSummary(weighing.plan, weighing.answers) : []

  return (
    <div className="sky-decision">
      {crumbs}
      <header className="sky-future-head">
        <div>
          <div className="sky-decision-title">
            <h1>{decision.title}</h1>
            <span className="sky-future-state" data-state={decision.state}>
              {STATE[decision.state]}
            </span>
          </div>
          {stands && (
            <p className="sky-future-sub">
              <span>{stands}</span>
            </p>
          )}
        </div>
        <div className="sky-future-head-actions">
          {run && decision.state === 'open' && (
            <Button variant="primary" onClick={() => navigate(wizardHref(run))}>
              Pick up where you stopped
            </Button>
          )}
          <Button component="a" href={fileHref(decision.file)} variant="secondary">
            Open the file
          </Button>
        </div>
      </header>
      {decision.contextHtml.trim() && <RenderedHtml className="sky-decision-context" html={decision.contextHtml} />}
      {wider.length > 0 && (
        <div className="sky-decision-under">
          <small>{wider.length > 1 ? 'The bigger questions it sits under' : 'The bigger question it sits under'}</small>
          {wider.map((frame) => (
            <p key={frame.title}>
              <b>{frame.title}</b>
              {frame.why}
            </p>
          ))}
        </div>
      )}

      {weighing && (
        <>
          <Weighing plan={weighing.plan} answers={weighing.answers} made={decision.state !== 'open'} />
          {(summary.length > 0 || run) && (
            <section className="sky-decision-sky" aria-labelledby="sky-decision-sky">
              <h2 id="sky-decision-sky">Sky</h2>
              {summary.length > 0 && <p>{summary.join(' ')}</p>}
              {run && (
                <div className="sky-decision-sky-actions">
                  <Button onClick={() => talkItThrough(run, decision.title, decisionHref(decision.name))}>
                    Talk it through
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {decision.state !== 'open' && (
        <section className="sky-decision-settled" aria-labelledby="sky-decision-settled">
          <h2 id="sky-decision-settled">
            {decision.state === 'inForce' ? 'Nothing to check off.' : 'This one is settled.'}
          </h2>
          <p>
            {decision.state === 'inForce'
              ? 'Sky keeps this in view in every chat and says so when a plan cuts against it.'
              : 'It stays in your notebook as the record of what you chose and why.'}
          </p>
        </section>
      )}

      {decision.sections.length > 0 && (
        <section className="sky-future-section" aria-labelledby="sky-decision-record">
          <h2 id="sky-decision-record">The record</h2>
          <p className="sky-decision-note">As it is written in the decision’s file.</p>
          <div className="sky-decision-record">
            {decision.sections.map((section) => (
              <div key={section.heading}>
                <h3>{section.heading}</h3>
                <RenderedHtml className="sky-future-document" html={section.html} />
              </div>
            ))}
          </div>
        </section>
      )}

      {decision.goals.length > 0 && (
        <section className="sky-future-section" aria-labelledby="sky-decision-goals">
          <h2 id="sky-decision-goals">
            Goals it weighs on<small>{decision.goals.length}</small>
          </h2>
          <div className="sky-future-rows">
            {decision.goals.map((goal) => (
              <div className="sky-future-row" key={goal.name}>
                <TieLink kind="goal" name={goal.name} title={goal.title} navigate={navigate} />
              </div>
            ))}
          </div>
        </section>
      )}
      {decision.decisions.length > 0 && (
        <section className="sky-future-section" aria-labelledby="sky-decision-others">
          <h2 id="sky-decision-others">
            Decisions it is tied to<small>{decision.decisions.length}</small>
          </h2>
          <div className="sky-future-rows">
            {decision.decisions.map((other) => (
              <div className="sky-future-row" key={other.file}>
                <TieLink kind="decision" name={other.name} title={other.title} file={other.file} navigate={navigate} />
                <span className="sky-future-meta">{STATE[other.state]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
