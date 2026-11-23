import { Button, Modal, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { FutureEnding, FutureGoal } from '../../../service/handler/future/types.ts'
import { ENDINGS } from './endings.ts'
import { futureRequest } from './request.ts'

/**
 * Close a goal: say how it ended and when. The goal's file moves under that
 * ending, and the page keeps it among past goals.
 */
export function CloseGoalDialog({
  goal,
  today,
  preset,
  onClose,
  onClosed,
}: {
  goal: FutureGoal
  today: string
  /** The ending the page already knows, when the number or the date says it */
  preset: FutureEnding | null
  onClose: () => void
  onClosed: () => Promise<void>
}) {
  const [ending, setEnding] = useState<FutureEnding | null>(preset)
  // A goal whose date has passed ended on that date unless the person says otherwise.
  const [ended, setEnded] = useState(goal.due && goal.due < today ? goal.due : today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = ending !== null && /^\d{4}-\d{2}-\d{2}$/.test(ended)
  return (
    <Modal opened onClose={onClose} title="Close this goal" size="md" closeOnClickOutside={!busy} closeOnEscape={!busy}>
      <form
        className="sky-future-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!ready || busy) return
          setBusy(true)
          setError('')
          try {
            await futureRequest(`/goals/${encodeURIComponent(goal.name)}/close`, { ending, ended, note: note.trim() })
            await onClosed()
            onClose()
          } catch (problem) {
            setError((problem as Error).message)
            setBusy(false)
          }
        }}
      >
        <p className="sky-future-form-intro">
          A closed goal leaves your chats and moves to Past goals on this page. You can reopen it later.
        </p>
        <fieldset className="sky-future-endings">
          <legend>How did it end?</legend>
          {ENDINGS.map((option) => (
            <label key={option.ending} className="sky-future-ending" data-checked={ending === option.ending}>
              <input
                type="radio"
                name="ending"
                value={option.ending}
                checked={ending === option.ending}
                onChange={() => setEnding(option.ending)}
              />
              <span>
                <strong>{option.label}</strong>
                <em>{option.meaning}</em>
              </span>
            </label>
          ))}
        </fieldset>
        <TextInput
          label="When did it end?"
          description={
            goal.number ? `Sky records where ${goal.number.trackerTitle} stood that day.` : 'The day it was settled.'
          }
          type="date"
          max={today}
          value={ended}
          onChange={(event) => setEnded(event.currentTarget.value)}
        />
        <Textarea
          label="Anything to remember?"
          description="Optional. It is added to the goal’s file in your words."
          size="sm"
          autosize
          minRows={2}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        {error && (
          <p className="sky-future-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sky-dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!ready}>
            Close goal
          </Button>
        </div>
      </form>
    </Modal>
  )
}
