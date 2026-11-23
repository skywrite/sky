import type { ReactNode } from 'react'
import type { FutureGoal } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { FutureLink } from './FutureLink.tsx'
import { Mark } from './Mark.tsx'
import { goalHref } from './routes.ts'
import { Standing } from './Standing.tsx'
import { TieLink } from './TieLink.tsx'

/** How many made decisions a goal shows before the rest wait on its page */
const DECIDED_SHOWN = 3

/** One goal on the Goals view: where it stands, and what is working toward it. */
export function GoalBlock({
  goal,
  today,
  navigate,
}: {
  goal: FutureGoal
  today: string
  navigate: (to: string) => void
}) {
  const ties: Array<[string, ReactNode[]]> = [
    ['Smaller goals', goal.smaller.map((tie) => <TieLink key={tie.name} kind="goal" {...tie} navigate={navigate} />)],
    ['To decide', goal.toDecide.map((tie) => <TieLink key={tie.file} kind="decision" {...tie} navigate={navigate} />)],
    ['Habits', goal.habits.map((tie) => <TieLink key={tie.name} kind="habit" {...tie} navigate={navigate} />)],
    ['Ideas', goal.ideas.map((tie) => <TieLink key={tie.file} kind="idea" {...tie} navigate={navigate} />)],
    [
      'Decided',
      [
        ...goal.decided.slice(0, DECIDED_SHOWN).map((tie) => (
          <span key={tie.file}>
            <TieLink kind="decision" {...tie} navigate={navigate} />
            {tie.since && <span className="sky-future-tag">{niceDate(tie.since, today)}</span>}
          </span>
        )),
        ...(goal.decided.length > DECIDED_SHOWN
          ? [
              <FutureLink key="more" to={goalHref(goal.name)} navigate={navigate} className="sky-future-text-link">
                and {goal.decided.length - DECIDED_SHOWN} more
              </FutureLink>,
            ]
          : []),
      ],
    ],
  ]
  const shown = ties.filter(([, links]) => links.length > 0)
  return (
    <section className="sky-future-goal" aria-label={goal.title}>
      <div className="sky-future-goal-head">
        <FutureLink to={goalHref(goal.name)} navigate={navigate} className="sky-future-goal-title sky-future-item">
          <Mark kind="goal" />
          <span>{goal.title}</span>
        </FutureLink>
        <span className="sky-future-cat">{goal.category}</span>
      </div>
      {goal.serves && (
        <p className="sky-future-stand">
          <span>
            Serves{' '}
            <FutureLink to={goalHref(goal.serves.name)} navigate={navigate} className="sky-future-text-link">
              {goal.serves.title}
            </FutureLink>
          </span>
        </p>
      )}
      <Standing goal={goal} today={today} navigate={navigate} />
      {(goal.number?.reached || (goal.daysLeft !== null && goal.daysLeft < 0)) && (
        <p className="sky-future-stand">
          <FutureLink to={goalHref(goal.name)} navigate={navigate} className="sky-future-text-link">
            {goal.number?.reached ? 'You’re there. Close this goal' : 'Its date has passed. Close it or move the date'}
          </FutureLink>
        </p>
      )}
      {shown.length ? (
        <dl className="sky-future-ties">
          {shown.map(([label, links]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{links}</dd>
            </div>
          ))}
        </dl>
      ) : (
        goal.inForce.length === 0 && (
          <p className="sky-future-stand" data-empty="true">
            Nothing is working toward this goal yet. No habits, no ideas, no decisions made for it.
          </p>
        )
      )}
    </section>
  )
}
