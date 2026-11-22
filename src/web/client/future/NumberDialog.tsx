import { Button, Modal, NativeSelect, TextInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { TrackingReport } from '#lib/tracking/types.ts'
import { primaryTrackingColumn } from '#lib/tracking/values.ts'
import type { FutureGoal } from '../../../service/handler/future/types.ts'
import { trackingRequest } from '../tracking/trackingData.ts'
import { FutureLink } from './FutureLink.tsx'
import { futureRequest } from './request.ts'

interface Followed {
  name: string
  title: string
  unit: string
}

/**
 * Connect the number a goal follows: one already kept in Tracking, what it
 * should reach, by when, and the day work on it began.
 */
export function NumberDialog({
  goal,
  today,
  onClose,
  onSaved,
  navigate,
}: {
  goal: FutureGoal
  today: string
  onClose: () => void
  onSaved: () => Promise<void>
  navigate: (to: string) => void
}) {
  const [numbers, setNumbers] = useState<Followed[] | null>(null)
  const [track, setTrack] = useState(goal.number?.tracker ?? '')
  const [target, setTarget] = useState(goal.number?.target?.toString() ?? '')
  const [due, setDue] = useState(goal.due ?? '')
  const [start, setStart] = useState(goal.start ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    trackingRequest<TrackingReport>('/report?days=1')
      .then((report) => {
        if (!live) return
        const found = report.metrics.flatMap(({ tracker }) => {
          const column = primaryTrackingColumn(tracker)
          return tracker.status === 'active' && column && ['number', 'duration'].includes(column.type)
            ? [{ name: tracker.name, title: tracker.title, unit: column.unit ?? '' }]
            : []
        })
        setNumbers(found)
        setTrack((current) => current || found[0]?.name || '')
      })
      .catch((problem) => live && setError((problem as Error).message))
    return () => {
      live = false
    }
  }, [])
  const unit = numbers?.find((item) => item.name === track)?.unit ?? ''
  const amount = Number(target)
  const ready = Boolean(track) && target.trim() !== '' && Number.isFinite(amount)
  return (
    <Modal
      opened
      onClose={onClose}
      title={goal.number ? 'Change the number' : 'Connect a number'}
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      {numbers?.length === 0 ? (
        <div className="sky-future-form">
          <p className="sky-future-form-intro">
            You aren’t tracking any numbers yet. Start one in Tracking, record it for a few days, then connect it here.
          </p>
          <div className="sky-dialog-actions">
            <Button onClick={onClose}>Cancel</Button>
            <FutureLink to="/tracking/new" navigate={navigate} className="sky-future-button-link">
              Start tracking a number
            </FutureLink>
          </div>
        </div>
      ) : (
        <form
          className="sky-future-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!ready || busy) return
            setBusy(true)
            setError('')
            try {
              await futureRequest(`/goals/${encodeURIComponent(goal.name)}/number`, {
                track,
                target: amount,
                due: due || null,
                start: start || null,
              })
              await onSaved()
              onClose()
            } catch (problem) {
              setError((problem as Error).message)
              setBusy(false)
            }
          }}
        >
          <p className="sky-future-form-intro">
            Sky reads the number from Tracking and shows how far this goal has come and how far it has to go.
          </p>
          <NativeSelect
            label="Which number?"
            data={numbers ? numbers.map((item) => ({ value: item.name, label: item.title })) : ['Loading…']}
            disabled={!numbers}
            value={track}
            onChange={(event) => setTrack(event.currentTarget.value)}
          />
          <TextInput
            label="What should it reach?"
            inputMode="decimal"
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
            rightSection={unit ? <span className="sky-future-unit">{unit}</span> : undefined}
            rightSectionWidth={unit ? 52 : undefined}
            error={target.trim() && !Number.isFinite(amount) ? 'Write a number, like 26.2.' : null}
          />
          <div className="sky-future-form-dates">
            <TextInput
              label="By when?"
              description="Leave empty for no date."
              type="date"
              value={due}
              onChange={(event) => setDue(event.currentTarget.value)}
            />
            <TextInput
              label="When did you start?"
              description="Progress counts from this day."
              type="date"
              max={today}
              value={start}
              onChange={(event) => setStart(event.currentTarget.value)}
            />
          </div>
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
              {goal.number ? 'Save' : 'Connect'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
