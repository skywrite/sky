import { Button, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { FutureGoal } from '../../../service/handler/future/types.ts'
import { niceDate } from './dates.ts'
import { futureRequest } from './request.ts'

const STATE = { reached: 'Reached', missed: 'Missed', ahead: 'Still ahead' } as const

/**
 * A goal's checkpoints: the same number at earlier dates. Each one is a line in
 * the goal's file, added and removed here.
 */
export function Checkpoints({
  goal,
  today,
  onChanged,
}: {
  goal: FutureGoal
  today: string
  onChanged: () => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unit = goal.number?.unit ?? ''
  const change = async (url: string, body: unknown): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await futureRequest(`/goals/${encodeURIComponent(goal.name)}${url}`, body)
      await onChanged()
      return true
    } catch (problem) {
      setError((problem as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const amount = Number(value)
  const ready = value.trim() !== '' && Number.isFinite(amount) && /^\d{4}-\d{2}-\d{2}$/.test(date)
  return (
    <>
      <p className="sky-future-note">
        The same number at an earlier date. A different outcome is a goal of its own that serves this one.
      </p>
      {goal.checkpoints.length > 0 && (
        <div className="sky-future-rows">
          {goal.checkpoints.map((checkpoint) => (
            <div className="sky-future-row" key={checkpoint.date}>
              <span>
                {checkpoint.text} by {niceDate(checkpoint.date, today)}
              </span>
              <span className="sky-future-row-end">
                <span className="sky-future-state" data-state={checkpoint.state}>
                  {STATE[checkpoint.state]}
                </span>
                <button
                  type="button"
                  className="sky-future-remove"
                  disabled={busy}
                  aria-label={`Remove the checkpoint on ${niceDate(checkpoint.date, today)}`}
                  onClick={() => void change('/checkpoints/remove', { date: checkpoint.date })}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <form
        className="sky-future-checkpoint-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!ready || busy) return
          if (await change('/checkpoints', { value: amount, date })) {
            setValue('')
            setDate('')
          }
        }}
      >
        <TextInput
          label="Number"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          rightSection={unit ? <span className="sky-future-unit">{unit}</span> : undefined}
          rightSectionWidth={unit ? 52 : undefined}
        />
        <TextInput
          label="By"
          type="date"
          min={today}
          max={goal.due ?? undefined}
          value={date}
          onChange={(event) => setDate(event.currentTarget.value)}
        />
        <Button type="submit" variant="secondary" loading={busy} disabled={!ready}>
          Add checkpoint
        </Button>
      </form>
      {error && (
        <p className="sky-future-form-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
