import { ActionIcon, Button, Checkbox, NativeSelect, Textarea, TextInput } from '@mantine/core'
import { useRef, useState } from 'react'
import type { Tracker, TrackerInput } from '#lib/tracking/types.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { trackingRequest, type TrackingActions } from './trackingData.ts'
import { answerLabel, TrackingIcon, TrackingLink } from './trackingShared.tsx'

const formats = [
  { value: 'number', label: 'Number' },
  { value: 'duration', label: 'Duration' },
  { value: 'time', label: 'Time' },
  { value: 'range', label: 'Time range' },
  { value: 'word', label: 'Short answer' },
  { value: 'text', label: 'Text' },
]
const aggregates = [
  { value: 'last', label: 'Last entry' },
  { value: 'sum', label: 'Add entries' },
  { value: 'mean', label: 'Average entries' },
  { value: 'collect', label: 'Keep each answer' },
]

export function TrackingSetup({
  tracker: incomingTracker,
  today,
  actions,
  onCreated,
  navigate,
}: {
  tracker?: Tracker
  today: string
  actions: TrackingActions
  onCreated: (name: string) => void
  navigate: (path: string) => void
}) {
  const tracker = useRef(incomingTracker).current
  const [draft, setDraft] = useState<TrackerInput>(() =>
    tracker
      ? {
          title: tracker.title,
          question: tracker.question,
          category: tracker.category,
          ask: tracker.ask,
          schedule: tracker.schedule,
          columns: tracker.columns,
          start: tracker.start ?? today,
          end: tracker.end,
          markdown: tracker.markdown,
        }
      : {
          title: '',
          question: '',
          category: '',
          ask: 'morning',
          schedule: 'daily',
          columns: [{ name: 'value', type: 'number', aggregate: 'last' }],
          start: today,
          end: null,
          markdown: '',
        },
  )
  const [error, setError] = useState('')
  const request = useRef({ payload: '', id: crypto.randomUUID() })
  const locked = tracker?.hasRecords ?? false
  const original = new Set(tracker?.columns.map((column) => column.name) ?? [])
  const notes = draft.columns.some((column) => column.name === 'notes')
  const update = <K extends keyof TrackerInput>(key: K, value: TrackerInput[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setError('')
  }
  const changeColumn = (index: number, patch: Partial<TrackingColumn>) =>
    update(
      'columns',
      draft.columns.map((column, at) => (at === index ? { ...column, ...patch } : column)),
    )
  const save = async () => {
    setError('')
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.start)) throw new Error('Use YYYY-MM-DD for the start date.')
      new PlainDate(draft.start)
      if (draft.end) {
        new PlainDate(draft.end)
        if (draft.end < draft.start) throw new Error('The end date must be on or after the start date.')
      }
      if (!draft.title.trim()) throw new Error('Give this tracker a name.')
      if (draft.columns.some((column) => !column.name.trim())) throw new Error('Give each answer a name.')
      if (new Set(draft.columns.map((column) => column.name.trim().toLowerCase())).size !== draft.columns.length)
        throw new Error('Each answer needs a different name.')
    } catch (problem) {
      setError((problem as Error).message)
      return
    }
    const payload = JSON.stringify(draft)
    if (request.current.payload !== payload) request.current = { payload, id: crypto.randomUUID() }
    const result = await actions.act(tracker ? 'Tracker updated' : 'Tracker created', () =>
      trackingRequest(tracker ? `/${encodeURIComponent(tracker.name)}/configure` : '/create', {
        operationId: request.current.id,
        ...(tracker ? { revision: tracker.revision } : {}),
        tracker: draft,
      }),
    )
    if (result) onCreated(result.name)
  }
  const prompt = draft.schedule !== 'manual' && draft.ask !== 'anytime'
  return (
    <>
      <div className="sky-tracking-breadcrumb">
        <TrackingLink to="/tracking" navigate={navigate}>
          Tracking
        </TrackingLink>
        <TrackingIcon name="chevron" />
        <span>{tracker ? 'Edit tracker' : 'New tracker'}</span>
      </div>
      <header className="sky-tracking-heading">
        <div>
          <h1>{tracker ? `Edit ${tracker.title}` : 'What would you like to track?'}</h1>
          <p>Start with a useful question. Keep the answer easy.</p>
        </div>
      </header>
      <div className="sky-tracking-setup">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <TextInput
            label="Name"
            value={draft.title}
            onChange={(event) => update('title', event.currentTarget.value)}
            placeholder="e.g. Energy"
            required
            disabled={actions.busy}
          />
          <TextInput
            label="Question to ask you"
            value={draft.question}
            onChange={(event) => update('question', event.currentTarget.value)}
            placeholder="e.g. How was your energy today, from 1 to 5?"
            disabled={actions.busy}
          />
          <Textarea
            label="Why it matters / notes"
            description="Optional · markdown is supported"
            value={draft.markdown}
            onChange={(event) => update('markdown', event.currentTarget.value)}
            minRows={2}
            maxRows={12}
            autosize
            disabled={actions.busy}
          />
          <section className="sky-tracking-form-section">
            <h3>What goes in an entry?</h3>
            <p className="sky-tracking-hint">One entry can have several answers.</p>
            {locked && (
              <p className="sky-tracking-hint">
                Existing answers keep their names, formats, and units so history stays readable. You can add more
                answers.
              </p>
            )}
            {draft.columns.map((column, index) =>
              column.name === 'notes' ? null : (
                <div className="sky-tracking-column" key={index}>
                  <div className="sky-tracking-column-fields">
                    <TextInput
                      label="Answer"
                      aria-label={`Answer ${index + 1} name`}
                      value={column.name}
                      onChange={(event) => changeColumn(index, { name: event.currentTarget.value })}
                      disabled={actions.busy || (locked && original.has(column.name))}
                      required
                    />
                    <NativeSelect
                      label="Format"
                      aria-label={`Answer ${index + 1} format`}
                      value={column.type}
                      data={formats}
                      onChange={(event) =>
                        changeColumn(index, {
                          type: event.currentTarget.value as TrackingColumn['type'],
                          aggregate: ['number', 'duration'].includes(event.currentTarget.value)
                            ? column.aggregate
                            : 'collect',
                        })
                      }
                      disabled={actions.busy || (locked && original.has(column.name))}
                    />
                    <TextInput
                      label="Unit"
                      aria-label={`Answer ${index + 1} unit`}
                      value={column.unit ?? ''}
                      onChange={(event) => changeColumn(index, { unit: event.currentTarget.value })}
                      placeholder="Optional"
                      disabled={actions.busy || (locked && original.has(column.name))}
                    />
                  </div>
                  <div className="sky-tracking-column-summary">
                    <NativeSelect
                      label="Daily summary"
                      aria-label={`Answer ${index + 1} daily summary`}
                      value={column.aggregate ?? 'last'}
                      data={aggregates.filter(
                        (option) =>
                          ['number', 'duration'].includes(column.type) || !['sum', 'mean'].includes(option.value),
                      )}
                      onChange={(event) =>
                        changeColumn(index, { aggregate: event.currentTarget.value as TrackingColumn['aggregate'] })
                      }
                      disabled={actions.busy}
                    />
                    <ActionIcon
                      aria-label={`Remove answer ${index + 1}`}
                      variant="danger-quiet"
                      disabled={
                        actions.busy ||
                        (locked && original.has(column.name)) ||
                        draft.columns.filter((c) => c.name !== 'notes').length < 2
                      }
                      onClick={() =>
                        update(
                          'columns',
                          draft.columns.filter((_, at) => at !== index),
                        )
                      }
                    >
                      ×
                    </ActionIcon>
                  </div>
                </div>
              ),
            )}
            <Checkbox
              label="Include optional notes"
              checked={notes}
              disabled={actions.busy || (locked && original.has('notes'))}
              onChange={(event) =>
                update(
                  'columns',
                  event.currentTarget.checked
                    ? [...draft.columns, { name: 'notes', type: 'text', aggregate: 'collect' }]
                    : draft.columns.filter((column) => column.name !== 'notes'),
                )
              }
            />
            <Button
              variant="primary-quiet"
              size="compact-sm"
              leftSection={<TrackingIcon name="plus" />}
              disabled={actions.busy}
              onClick={() => {
                let name = 'answer'
                for (let i = 2; draft.columns.some((column) => column.name === name); i++) name = `answer_${i}`
                update('columns', [...draft.columns, { name, type: 'number', aggregate: 'last' }])
              }}
            >
              Add another answer
            </Button>
          </section>
          <section className="sky-tracking-form-section">
            <h3>When should it appear?</h3>
            <div className="sky-tracking-form-grid">
              <NativeSelect
                label="Track"
                value={draft.schedule}
                data={[
                  { value: 'daily', label: 'Every day' },
                  { value: 'weekdays', label: 'Weekdays' },
                  { value: 'manual', label: 'When I choose' },
                ]}
                onChange={(event) => update('schedule', event.currentTarget.value as TrackerInput['schedule'])}
                disabled={actions.busy}
              />
              <NativeSelect
                label="Ask me"
                value={draft.ask}
                data={[
                  { value: 'morning', label: 'In the morning' },
                  { value: 'evening', label: 'In the evening' },
                  { value: 'anytime', label: 'Don’t prompt me' },
                ]}
                onChange={(event) => update('ask', event.currentTarget.value as TrackerInput['ask'])}
                disabled={actions.busy || draft.schedule === 'manual'}
              />
            </div>
            <p className="sky-tracking-hint">
              Questions appear in Today’s check-in. You can always log an entry yourself.
            </p>
          </section>
          <details className="sky-tracking-advanced">
            <summary>More options</summary>
            <div className="sky-tracking-form-grid">
              <TextInput
                label="Category"
                value={draft.category}
                onChange={(event) => update('category', event.currentTarget.value)}
                disabled={actions.busy || tracker?.storage === 'weekly'}
              />
              <TextInput
                label="Start date"
                description="YYYY-MM-DD"
                value={draft.start}
                onChange={(event) => update('start', event.currentTarget.value)}
                disabled={actions.busy}
                required
              />
              <TextInput
                label="End date"
                description="Optional · YYYY-MM-DD"
                value={draft.end ?? ''}
                onChange={(event) => update('end', event.currentTarget.value || null)}
                disabled={actions.busy}
              />
            </div>
          </details>
          {(error || actions.error) && (
            <p className="sky-tracking-error" role="alert">
              {error || actions.error}
            </p>
          )}
          <div className="sky-dialog-actions sky-tracking-setup-actions">
            <Button variant="secondary" onClick={() => navigate('/tracking')} disabled={actions.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={actions.busy}>
              {tracker ? 'Save changes' : 'Start tracking'}
            </Button>
          </div>
        </form>
        <aside className="sky-tracking-preview">
          <p className="sky-tracking-hint">Your check-in will look like this</p>
          <div className="sky-tracking-preview-card">
            <div className="sky-tracking-row">
              <h3>{draft.title || 'Your tracker'}</h3>
              <span className="sky-tracking-tag">{prompt ? answerLabel(draft.ask) : 'On demand'}</span>
            </div>
            <p className="sky-tracking-preview-question">{draft.question || 'Your question goes here.'}</p>
            {draft.columns.map((column, index) => (
              <div className="sky-tracking-preview-answer" key={index}>
                <span>
                  {answerLabel(column.name)}
                  {column.name === 'notes' ? ' · optional' : ''}
                </span>
                <div>
                  <span>
                    {column.name === 'notes'
                      ? 'Anything you want to remember'
                      : column.type === 'number'
                        ? '4'
                        : column.type === 'duration'
                          ? '1h 30m'
                          : column.type === 'time'
                            ? '06:45'
                            : column.type === 'range'
                              ? '23:00–06:30'
                              : 'Your answer'}
                  </span>
                  <small>{column.unit}</small>
                </div>
              </div>
            ))}
            <Button variant="primary" fullWidth tabIndex={-1} aria-disabled="true">
              Save entry
            </Button>
          </div>
          <p className="sky-tracking-preview-context">
            <strong>
              {prompt
                ? `${answerLabel(draft.ask)} check-in · ${draft.schedule === 'weekdays' ? 'weekdays' : 'every day'}.`
                : 'Log whenever you choose.'}
            </strong>
            <br />
            {prompt
              ? 'Once answered, it stays visible as logged for the day.'
              : 'This tracker won’t appear as a check-in question.'}
            <br />
            You can add more entries whenever you need to.
          </p>
        </aside>
      </div>
    </>
  )
}
