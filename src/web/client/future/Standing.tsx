import type { FutureGoal } from '../../../service/handler/future/types.ts'
import { niceDate, timeLeft } from './dates.ts'
import { FutureLink } from './FutureLink.tsx'
import { goalHref } from './routes.ts'

/** Where a goal stands, in a line and a bar: how far the number has come, and how much of the time is gone. */
export function Standing({
  goal,
  today,
  navigate,
}: {
  goal: FutureGoal
  today: string
  navigate: (to: string) => void
}) {
  const number = goal.number
  if (!number)
    return (
      <p className="sky-future-stand" data-empty="true">
        {goal.numberProblem ?? 'No number connected, so Sky can’t say where this stands.'}{' '}
        <FutureLink to={goalHref(goal.name)} navigate={navigate} className="sky-future-text-link">
          {goal.numberProblem ? 'Choose another number' : 'Connect a number'}
        </FutureLink>
      </p>
    )
  if (!number.latest)
    return (
      <p className="sky-future-stand" data-empty="true">
        Nothing recorded for {number.trackerTitle} since {niceDate(number.from, today)}.
      </p>
    )
  const way = number.progress === null ? null : Math.round(number.progress * 100)
  const time = number.dueDay ? Math.round((number.endDay / number.dueDay) * 100) : goal.due ? 100 : null
  return (
    <>
      <p className="sky-future-stand">
        <span>
          {number.latest.text} {number.latest.date === today ? 'today' : `on ${niceDate(number.latest.date, today)}`}
        </span>
        {number.reached ? <span>Reached</span> : number.toGoText && <span>{number.toGoText} to go</span>}
        {goal.daysLeft !== null && !number.reached && <span>{timeLeft(goal.daysLeft)}</span>}
      </p>
      {way !== null && number.first && (
        <div className="sky-future-track">
          <div
            className="sky-future-track-bar"
            role="img"
            aria-label={`${way}% of the way${time === null ? '' : `, ${time}% of the time gone`}`}
          >
            <div className="sky-future-track-fill" style={{ width: `${way}%` }} />
            {time !== null && <div className="sky-future-track-time" style={{ left: `${time}%` }} />}
          </div>
          <div className="sky-future-track-ends">
            <span>
              {number.first.text} on {niceDate(number.first.date, today)}
            </span>
            <span>
              {number.targetText}
              {goal.due ? ` on ${niceDate(goal.due, today)}` : ''}
            </span>
          </div>
          <p className="sky-future-track-cap">
            {way}% of the way there.{time === null ? '' : ` ${time}% of the time is gone (the dark mark).`}
          </p>
        </div>
      )}
    </>
  )
}
