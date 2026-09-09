import { Button, Drawer, Modal, SegmentedControl, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useRef, useState } from 'react'
import type { TrackingEntry, TrackingMetric, TrackingPreview } from '#lib/tracking/types.ts'
import { formatTrackingValue, normalizeTrackingValue } from '#lib/tracking/values.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { trackingRequest, type TrackingActions } from './trackingData.ts'
import { answerLabel } from './trackingShared.tsx'

export interface TrackingLogTarget {
  metric: TrackingMetric
  date: string
  entry?: TrackingEntry
}

export function TrackingLogDialog({
  target,
  time,
  canParse,
  actions,
  onClose,
}: {
  target: TrackingLogTarget
  time: string
  canParse: boolean
  actions: TrackingActions
  onClose: () => void
}) {
  const { tracker } = target.metric
  const narrow = useMediaQuery('(max-width: 600px)')
  const [mode, setMode] = useState('fields')
  const [date, setDate] = useState(target.entry?.date ?? target.date)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      tracker.columns.map((column) => [
        column.name,
        target.entry ? (target.entry.values[column.name] ?? '') : column.type === 'time' ? time : '',
      ]),
    ),
  )
  const [sentence, setSentence] = useState('')
  const [preview, setPreview] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const request = useRef({ payload: '', id: crypto.randomUUID() })
  const pending = useRef(false)
  const busy = actions.busy || parsing
  const changeValue = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setError('')
  }
  const save = async () => {
    if (busy || pending.current) return
    setError('')
    let normalized: Record<string, string>
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter the date as YYYY-MM-DD.')
      new PlainDate(date)
      normalized = Object.fromEntries(
        tracker.columns.map((column) => [column.name, normalizeTrackingValue(column, values[column.name] ?? '')]),
      )
    } catch (problem) {
      setError((problem as Error).message)
      setMode('fields')
      return
    }
    const body = {
      revision: tracker.revision,
      date,
      values: normalized,
      ...(target.entry ? { entry: { id: target.entry.id, date: target.entry.date } } : {}),
    }
    const payload = JSON.stringify(body)
    if (request.current.payload !== payload) request.current = { payload, id: crypto.randomUUID() }
    pending.current = true
    const result = await actions.act(`${tracker.title} ${target.entry ? 'updated' : 'saved'} · ${date}`, () =>
      trackingRequest(`/${encodeURIComponent(tracker.name)}/entries`, { ...body, operationId: request.current.id }),
    )
    pending.current = false
    if (result) onClose()
  }
  const parse = async () => {
    if (!sentence.trim() || busy || pending.current) return
    pending.current = true
    setParsing(true)
    setError('')
    try {
      const result = await trackingRequest<TrackingPreview>(`/${encodeURIComponent(tracker.name)}/parse`, {
        text: sentence,
      })
      setValues(
        Object.fromEntries(
          tracker.columns.map((column) => [
            column.name,
            result.values[column.name] ?? (column.type === 'time' && !target.entry ? time : ''),
          ]),
        ),
      )
      setDate(result.date ?? '')
      if (result.message) setError(result.message)
      if (!result.date || !Object.keys(result.values).length) {
        setMode('fields')
        setPreview(false)
      } else setPreview(true)
    } catch (problem) {
      setError(`${(problem as Error).message} You can fill in the fields instead.`)
    } finally {
      setParsing(false)
      pending.current = false
    }
  }
  const remove = async () => {
    if (!target.entry || busy) return
    const entry = { id: target.entry.id, date: target.entry.date }
    const result = await actions.act('Entry deleted', () =>
      trackingRequest(`/${encodeURIComponent(tracker.name)}/entries/delete`, {
        operationId: crypto.randomUUID(),
        entry,
      }),
    )
    if (result) onClose()
  }
  const title = `${target.entry ? 'Edit' : 'Log'} ${tracker.title.toLowerCase()}`
  const contents = (
    <div className="sky-tracking-dialog">
      {tracker.question && <p className="sky-tracking-dialog-sub">{tracker.question}</p>}
      {canParse && (
        <SegmentedControl
          fullWidth
          value={mode}
          onChange={(value) => {
            setMode(value)
            setError('')
          }}
          disabled={busy}
          data={[
            { value: 'fields', label: 'Fill in fields' },
            { value: 'sentence', label: 'Write a sentence' },
          ]}
        />
      )}
      {mode === 'fields' ? (
        <form
          id="sky-tracking-entry"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="sky-tracking-form-grid">
            <TextInput
              label="For date"
              description="YYYY-MM-DD · the day this observation belongs to"
              value={date}
              onChange={(event) => setDate(event.currentTarget.value)}
              required
              disabled={busy}
              autoComplete="off"
            />
            {tracker.columns.map((column) =>
              column.type === 'text' ? (
                <Textarea
                  key={column.name}
                  className="sky-tracking-field-wide"
                  autosize
                  minRows={2}
                  maxRows={5}
                  label={answerLabel(column.name)}
                  description={column.name === 'notes' ? 'Optional' : column.unit}
                  value={values[column.name] ?? ''}
                  onChange={(event) => changeValue(column.name, event.currentTarget.value)}
                  disabled={busy}
                />
              ) : (
                <TextInput
                  key={column.name}
                  label={answerLabel(column.name)}
                  description={
                    column.unit || (column.type === 'time' ? 'H:MM · extended hours are supported' : undefined)
                  }
                  value={values[column.name] ?? ''}
                  onChange={(event) => changeValue(column.name, event.currentTarget.value)}
                  placeholder={
                    column.type === 'duration'
                      ? 'e.g. 1h 30m'
                      : column.type === 'time'
                        ? 'e.g. 06:45'
                        : column.type === 'range'
                          ? 'e.g. 23:00–06:30'
                          : undefined
                  }
                  inputMode={column.type === 'number' ? 'decimal' : undefined}
                  disabled={busy}
                  autoComplete="off"
                />
              ),
            )}
          </div>
          {!target.entry && target.metric.entries.some((entry) => entry.date === date) && (
            <p className="sky-tracking-hint">You already have an entry on this day. This adds another observation.</p>
          )}
        </form>
      ) : (
        <div className="sky-tracking-sentence">
          <Textarea
            label="What would you like to record?"
            description="Include “yesterday” or a date to record another day."
            value={sentence}
            onChange={(event) => {
              setSentence(event.currentTarget.value)
              setPreview(false)
              setError('')
            }}
            minRows={3}
            autosize
            maxRows={8}
            disabled={busy}
            autoFocus
          />
          {preview && (
            <>
              <section className="sky-tracking-review">
                <div className="sky-tracking-review-head">Ready to save · {tracker.title}</div>
                <dl>
                  <div className="sky-tracking-review-date">
                    <dt>For date</dt>
                    <dd>{date}</dd>
                  </div>
                  {tracker.columns
                    .filter((column) => values[column.name])
                    .map((column) => (
                      <div key={column.name}>
                        <dt>{answerLabel(column.name)}</dt>
                        <dd>{formatTrackingValue(column, values[column.name])}</dd>
                      </div>
                    ))}
                </dl>
              </section>
              <p className="sky-tracking-hint">Review the date and values before saving.</p>
              <Button variant="primary-quiet" size="compact-sm" onClick={() => setMode('fields')}>
                Edit these fields
              </Button>
            </>
          )}
        </div>
      )}
      {(error || actions.error) && (
        <p className="sky-tracking-error" role="alert">
          {error || actions.error}
        </p>
      )}
      <div className="sky-dialog-actions sky-tracking-dialog-actions">
        {target.entry && (
          <Button
            variant="danger-quiet"
            size="sm"
            className="sky-tracking-delete"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete entry
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {mode === 'sentence' && !preview ? (
          <Button variant="primary" disabled={!sentence.trim()} loading={parsing} onClick={() => void parse()}>
            Review entry
          </Button>
        ) : (
          <Button variant="primary" loading={actions.busy} disabled={!date.trim()} onClick={() => void save()}>
            {target.entry ? 'Save changes' : 'Save entry'}
          </Button>
        )}
      </div>
    </div>
  )
  return narrow ? (
    <Drawer
      opened
      onClose={onClose}
      title={title}
      position="bottom"
      size="auto"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      {contents}
    </Drawer>
  ) : (
    <Modal
      opened
      onClose={onClose}
      title={title}
      size={610}
      centered
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      {contents}
    </Modal>
  )
}
