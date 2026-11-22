import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { FutureReport } from '../../../service/handler/future/types.ts'
import { AddGoalDialog } from './AddGoalDialog.tsx'
import { niceDate } from './dates.ts'
import { GoalBlock } from './GoalBlock.tsx'
import { GoalPage } from './GoalPage.tsx'
import { type FutureRoute, goalHref } from './routes.ts'
import { TieLink } from './TieLink.tsx'
import { useFutureReport } from './useFutureReport.ts'
import './FutureMain.css'

/** "A", "A and B", "A, B and C" */
const listed = (names: string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

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
  const goal = wanted === undefined ? undefined : report?.goals.find((item) => item.name.toLowerCase() === wanted)
  // The tab names the goal that is open; while it loads, or when it is gone, it still says which area this is.
  const title = goal?.title ?? 'Future'
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
              <GoalPage key={goal.name} goal={goal} today={report.today} navigate={navigate} onChanged={refresh} />
            ) : (
              <div className="sky-future-empty">
                <h2>This goal isn’t here</h2>
                <p>“{route.goal}” is not one of your active goals. It may have been renamed, archived, or reached.</p>
                <Button variant="primary" onClick={() => navigate('/future')}>
                  See your goals
                </Button>
              </div>
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
                {report.goals.length > 0 && (
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    ＋ Add a goal
                  </Button>
                )}
              </header>
              <InForce report={report} navigate={navigate} />
              {report.goals.length ? (
                <div className="sky-future-goals">
                  {report.goals.map((item) => (
                    <GoalBlock key={item.name} goal={item} today={report.today} navigate={navigate} />
                  ))}
                </div>
              ) : (
                <div className="sky-future-empty">
                  <h2>Start with one goal</h2>
                  <p>
                    Name one outcome you want. Sky keeps it in view in every chat and when it picks what matters each
                    day, and this page shows how far it has come.
                  </p>
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    ＋ Add a goal
                  </Button>
                </div>
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
