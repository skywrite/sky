import type { FuturePastGoal } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { ENDING_LABEL } from './endings.ts'
import { TieLink } from './TieLink.tsx'

/** The goals that ended, the latest first: how each ended, when, and where its number stood. */
export function PastGoals({
  goals,
  today,
  navigate,
}: {
  goals: FuturePastGoal[]
  today: string
  navigate: (to: string) => void
}) {
  if (!goals.length) return null
  return (
    <section className="sky-future-section" aria-labelledby="sky-future-past">
      <h2 id="sky-future-past">
        Past goals<small>{goals.length}</small>
      </h2>
      <div className="sky-future-rows">
        {goals.map((goal) => (
          <div className="sky-future-row" key={goal.name}>
            <span>
              <TieLink kind="goal" name={goal.name} title={goal.title} navigate={navigate} />
              {goal.final && <span className="sky-future-under">Ended at {goal.final}</span>}
            </span>
            <span className="sky-future-row-end">
              <span className="sky-future-state" data-state={goal.status}>
                {ENDING_LABEL[goal.status]}
              </span>
              {goal.ended && <span className="sky-future-meta">{niceDate(goal.ended, today)}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
