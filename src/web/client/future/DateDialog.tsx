import { Button, Modal, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { FutureGoal } from '../../../service/handler/future/types.ts'
import { futureRequest } from './request.ts'

/** Give a goal a new date, or take its date away. */
export function DateDialog({
  goal,
  today,
  onClose,
  onSaved,
}: {
  goal: FutureGoal
  today: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [due, setDue] = useState(goal.due && goal.due >= today ? goal.due : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (value: string | null) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await futureRequest(`/goals/${encodeURIComponent(goal.name)}/date`, { due: value })
      await onSaved()
      onClose()
    } catch (problem) {
      setError((problem as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal
      opened
      onClose={onClose}
      title={goal.due ? 'Move the date' : 'Set a date'}
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <form
        className="sky-future-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (due) void save(due)
        }}
      >
        <TextInput
          label="By when?"
          type="date"
          min={today}
          value={due}
          onChange={(event) => setDue(event.currentTarget.value)}
          data-autofocus
        />
        {error && (
          <p className="sky-future-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sky-dialog-actions">
          {goal.due && (
            <Button variant="danger-quiet" disabled={busy} onClick={() => void save(null)}>
              Remove the date
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!due}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
