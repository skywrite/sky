import { Button } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import type { FutureReport } from '../../../service/handler/future/types.ts'
import { AddGoalDialog } from './AddGoalDialog.tsx'
import { niceDate } from './dates.ts'
import { DecisionPage } from './DecisionPage.tsx'
import { DecisionsList } from './DecisionsList.tsx'
import { FutureLink } from './FutureLink.tsx'
import { GoalBlock } from './GoalBlock.tsx'
import { GoalPage } from './GoalPage.tsx'
import { PastGoals } from './PastGoals.tsx'
import { futureRequest } from './request.ts'
import { type FutureRoute, goalHref, wizardHref } from './routes.ts'
import { TieLink } from './TieLink.tsx'
import { useFutureReport } from './useFutureReport.ts'
import { useGoal } from './useGoal.ts'
import { Wizard } from './wizard/Wizard.tsx'
import { WizardStart } from './wizard/WizardStart.tsx'
import { listed } from './words.ts'
import './FutureMain.css'

/** The decisions that still bind what the person does, once, above the goals they serve. */
function InForce({ report, navigate }: { report: FutureReport; navigate: (to: string) => void }) {
  if (!report.inForce.length) return null
  return (
    <section className="sky-future-panel" aria-labelledby="sky-future-in-force">
      <h3 id="sky-future-in-force">In force across your goals</h3>
      <ul>
        {report.inForce.map((decision) => (
          <li key={decision.file}>
            <TieLink kind="decision" {...decision} navigate={navigate} />
            <span className="sky-future-why">
              {decision.since ? `In force since ${niceDate(decision.since, report.today)}. ` : ''}
              {decision.goals.length === 0
                ? 'Not tied to a goal yet.'
                : decision.goals.length > 1 && decision.goals.length === report.goals.length
                  ? `Serves all ${decision.goals.length} goals.`
                  : `Serves ${listed(decision.goals.map((goal) => goal.title))}.`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Future: the goals being pursued, where each stands, and what is working
 * toward it. `/future` lists them; `/future/goals/<name>` is one goal's page.
 */
export function FutureMain({ route, navigate }: { route: FutureRoute; navigate: (to: string) => void }) {
  const { report, error, refresh } = useFutureReport()
  const [adding, setAdding] = useState(false)
  const wanted = route.goal?.toLowerCase()
  const active = wanted === undefined ? undefined : report?.goals.find((item) => item.name.toLowerCase() === wanted)
  // A goal that is not among the active ones may have ended: its page is read on its own.
  const other = useGoal(route.goal !== null && report && !active ? route.goal : null)
  const ended = other.view && other.view.goal.name.toLowerCase() === wanted ? other.view.goal : undefined
  const goal = active ?? ended
  const changed = async () => {
    await refresh()
    await other.refresh()
  }
  // The tab names the goal that is open; while it loads, or when it is gone, it still says which area this is.
  // A wizard run and a decision's page name the tab themselves: the run while it thinks and then by the
  // decision's wording, the page by the decision's title.
  const opened = route.run ?? route.decision
  const [ownTitle, setOwnTitle] = useState<{ of: string; title: string } | null>(null)
  const named = useCallback((text: string) => setOwnTitle(opened ? { of: opened, title: text } : null), [opened])
  const title =
    goal?.title ??
    (ownTitle?.of === opened ? ownTitle?.title : null) ??
    (route.adding ? 'New decision' : route.decision ? 'Decision' : route.tab === 'decisions' ? 'Decisions' : 'Future')
  useEffect(() => {
    document.title = `sky · ${title}`
  }, [title])

  return (
    <div className="sky-main sky-future">
      <div className="sky-scroll">
        <div className="sky-future-col">
          {error && (
            <div className="sky-future-error" role="alert">
              {error}{' '}
              <Button variant="secondary" size="compact-sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          )}
          {!report ? (
            !error && (
              <p className="sky-future-hint" role="status">
                Loading your goals…
              </p>
            )
          ) : route.goal !== null ? (
            goal ? (
              <GoalPage key={goal.name} goal={goal} today={report.today} navigate={navigate} onChanged={changed} />
            ) : !other.missing ? (
              <p className="sky-future-hint" role="status">
                Loading this goal…
              </p>
            ) : (
              <div className="sky-future-empty">
                <h2>This goal isn’t here</h2>
                <p>“{route.goal}” is not one of your goals. It may have been renamed.</p>
                <Button variant="primary" onClick={() => navigate('/future')}>
                  See your goals
                </Button>
              </div>
            )
          ) : route.decision !== null ? (
            <DecisionPage key={route.decision} name={route.decision} navigate={navigate} onTitle={named} />
          ) : route.adding ? (
            route.run ? (
              <Wizard
                key={route.run}
                id={route.run}
                today={report.today}
                navigate={navigate}
                onTitle={named}
                onChanged={refresh}
              />
            ) : (
              <WizardStart navigate={navigate} onChanged={refresh} />
            )
          ) : (
            <>
              <header className="sky-future-head">
                <div>
                  <h1>Future</h1>
                  <p className="sky-future-sub">
                    <span>The future you want, and what shapes it.</span>
                  </p>
                </div>
                {route.tab === 'decisions'
                  ? report.decisions.length + report.wizards.length > 0 && (
                      <Button variant="primary" onClick={() => navigate(wizardHref())}>
                        ＋ Add a decision
                      </Button>
                    )
                  : report.goals.length > 0 && (
                      <Button variant="primary" onClick={() => setAdding(true)}>
                        ＋ Add a goal
                      </Button>
                    )}
              </header>
              <nav className="sky-future-tabs" aria-label="Future">
                <FutureLink to="/future" navigate={navigate} current={route.tab === 'goals'}>
                  Goals<small>{report.goals.length}</small>
                </FutureLink>
                <FutureLink to="/future/decisions" navigate={navigate} current={route.tab === 'decisions'}>
                  Decisions
                  <small>
                    {report.decisions.filter((decision) => decision.state !== 'decided').length +
                      report.wizards.filter((wizard) => !wizard.open).length}
                  </small>
                </FutureLink>
              </nav>
              {route.tab === 'decisions' ? (
                <DecisionsList
                  decisions={report.decisions}
                  wizards={report.wizards}
                  onDiscard={async (id) => {
                    await futureRequest(`/decisions/wizard/${id}/discard`, {})
                    await refresh()
                  }}
                  today={report.today}
                  navigate={navigate}
                  onAdd={() => navigate(wizardHref())}
                />
              ) : (
                <>
                  <InForce report={report} navigate={navigate} />
                  {report.goals.length ? (
                    <div className="sky-future-goals">
                      {report.goals.map((item) => (
                        <GoalBlock key={item.name} goal={item} today={report.today} navigate={navigate} />
                      ))}
                    </div>
                  ) : (
                    <div className="sky-future-empty">
                      <h2>{report.past.length ? 'Nothing in progress' : 'Start with one goal'}</h2>
                      <p>
                        Name one outcome you want. Sky keeps it in view in every chat and when it picks what matters
                        each day, and this page shows how far it has come.
                      </p>
                      <Button variant="primary" onClick={() => setAdding(true)}>
                        ＋ Add a goal
                      </Button>
                    </div>
                  )}
                  <PastGoals goals={report.past} today={report.today} navigate={navigate} />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {adding && (
        <AddGoalDialog
          onClose={() => setAdding(false)}
          onCreated={async (name) => {
            // Read first, so the new goal's page opens on the goal and not on "isn't here".
            await refresh()
            setAdding(false)
            navigate(goalHref(name))
          }}
        />
      )}
    </div>
  )
}
