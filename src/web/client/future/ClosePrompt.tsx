import { Button } from '@mantine/core'
import type { FutureEnding, FutureGoal } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'

/**
 * Sky asks, and never closes a goal itself: when the number has reached the
 * target it offers to close the goal as reached, and when the date has passed
 * it asks whether to close it or give it a new date.
 */
export function ClosePrompt({
  goal,
  today,
  onClose,
  onMoveDate,
}: {
  goal: FutureGoal
  today: string
  onClose: (ending: FutureEnding | null) => void
  onMoveDate: () => void
}) {
  const number = goal.number
  if (number?.reached && number.latest)
    return (
      <div className="sky-future-panel" role="status">
        <h3>You’re there</h3>
        <p>
          {number.latest.text} on {niceDate(number.latest.date, today)}. The goal was {number.targetText}.
        </p>
        <div className="sky-future-panel-actions">
          <Button variant="primary" onClick={() => onClose('reached')}>
            Close as reached
          </Button>
        </div>
      </div>
    )
  if (goal.due && goal.daysLeft !== null && goal.daysLeft < 0)
    return (
      <div className="sky-future-panel" role="status">
        <h3>The date has passed</h3>
        <p>
          {niceDate(goal.due, today)} has come and gone{number?.latest ? ` at ${number.latest.text}` : ''}. Close this
          goal, or give it a new date.
        </p>
        <div className="sky-future-panel-actions">
          <Button variant="primary" onClick={() => onClose(number ? 'missed' : null)}>
            {number ? 'Close as missed' : 'Close this goal'}
          </Button>
          <Button variant="secondary" onClick={onMoveDate}>
            Move the date
          </Button>
        </div>
      </div>
    )
  return null
}
