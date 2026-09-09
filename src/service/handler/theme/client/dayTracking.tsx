import { ActionIcon, Button, Modal, TextInput } from '@mantine/core'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { TrackingMetric } from '#lib/tracking/types.ts'
import { formatTrackingValue, isTrackingDay, primaryTrackingColumn } from '#lib/tracking/values.ts'
import { trackingRequest, useTrackingActions, useTrackingReport } from './trackingData.ts'
import { TrackingLogDialog, type TrackingLogTarget } from './trackingLog.tsx'
import { trackerHref, TrackerSymbol, TrackingFeedback, TrackingIcon, TrackingLink } from './trackingShared.tsx'
import './tracking.css'

function InlineTrackingAnswer({
  metric,
  busy,
  save,
}: {
  metric: TrackingMetric
  busy: boolean
  save: (value: string, operationId: string) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const operation = useRef(crypto.randomUUID())
  const column = primaryTrackingColumn(metric.tracker)!
  return (
    <form
      className="sky-tracking-quick"
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim())
          void save(value, operation.current).then((saved) => {
            if (saved) {
              setValue('')
              operation.current = crypto.randomUUID()
            }
          })
      }}
    >
      <TextInput
        aria-label={`${metric.tracker.title}${column.unit ? ` in ${column.unit}` : ''}`}
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value)
          operation.current = crypto.randomUUID()
        }}
        placeholder="Your answer"
        inputMode={column.type === 'number' ? 'decimal' : undefined}
        rightSection={column.unit ? <span>{column.unit}</span> : undefined}
        rightSectionWidth={column.unit ? Math.min(90, 20 + column.unit.length * 7) : undefined}
        required
        disabled={busy}
        autoComplete="off"
      />
      <Button
        variant="primary"
        type="submit"
        loading={busy}
        disabled={!value.trim()}
        aria-label={`Save ${metric.tracker.title}`}
      >
        Save
      </Button>
    </form>
  )
}

export function DayTracking({
  date,
  readOnly = false,
  navigate,
}: {
  date: string | null
  readOnly?: boolean
  navigate: (path: string) => void
}) {
  const query = date ? new URLSearchParams({ start: date, end: date }).toString() : 'days=1'
  const data = useTrackingReport(query),
    actions = useTrackingActions(data.refresh)
  const [target, setTarget] = useState<TrackingLogTarget | null>(null)
  const [chooser, setChooser] = useState(false)
  const [later, setLater] = useState<string[]>([])
  const { report } = data
  const day = date ?? report?.today ?? ''
  const isToday = day === report?.today
  useEffect(() => {
    if (!day) return
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(`sky-tracking-later:${day}`) ?? '[]')
      setLater(Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : [])
    } catch {
      setLater([])
    }
  }, [day])
  const defer = (name: string, deferred: boolean) => {
    const names = deferred ? [...new Set([...later, name])] : later.filter((value) => value !== name)
    setLater(names)
    try {
      sessionStorage.setItem(`sky-tracking-later:${day}`, JSON.stringify(names))
    } catch {
      /* The current view can still defer without storage. */
    }
  }
  const open = (next: TrackingLogTarget) => {
    actions.setError('')
    setChooser(false)
    setTarget(next)
  }
  if (!report && !data.error) return null
  const active = report?.metrics.filter((metric) => metric.tracker.status === 'active') ?? []
  const entries = (metric: TrackingMetric) => metric.entries.filter((entry) => entry.date === day)
  const scheduled = active.filter(
    (metric) => !!metric.tracker.question && isTrackingDay(metric.tracker, day) && metric.tracker.ask !== 'anytime',
  )
  const visible = (report?.metrics ?? [])
    .filter(
      (metric) =>
        entries(metric).length ||
        (scheduled.includes(metric) && (!isToday || report?.window === 'evening' || metric.tracker.ask === 'morning')),
    )
    .sort((a, b) => a.tracker.ask.localeCompare(b.tracker.ask) || a.tracker.title.localeCompare(b.tracker.title))
  const evening =
    isToday && report?.window === 'morning'
      ? scheduled.filter((metric) => metric.tracker.ask === 'evening' && !entries(metric).length)
      : []
  const expected = visible.filter((metric) => scheduled.includes(metric))
  const completed = expected.filter((metric) => entries(metric).length).length
  return (
    <section className="sky-tracking-day">
      <header className="sky-tracking-day-heading">
        <div>
          <h2>Tracking</h2>
          <p>
            {isToday ? `${report?.window === 'morning' ? 'Morning' : 'Evening'} check-in` : day}
            {expected.length > 0 && ` · ${completed} of ${expected.length} logged`}
          </p>
        </div>
        <TrackingLink to="/tracking" navigate={navigate} className="sky-tracking-text-link">
          View trends <TrackingIcon name="chevron" />
        </TrackingLink>
      </header>
      {data.error && (
        <p className="sky-tracking-error" role="alert">
          {data.error}{' '}
          <Button size="compact-sm" onClick={() => void data.refresh()}>
            Retry
          </Button>
        </p>
      )}
      {visible.map((metric) => {
        const column = primaryTrackingColumn(metric.tracker),
          logged = entries(metric),
          latest = logged.at(-1)
        const answers = metric.tracker.columns.filter((c) => c.type !== 'time' && c.name !== 'notes')
        const simple = answers.length === 1 && ['number', 'duration', 'word'].includes(answers[0].type)
        const deferred = later.includes(metric.tracker.name)
        return (
          <div className="sky-tracking-log-row" key={metric.tracker.name}>
            <TrackerSymbol tracker={metric.tracker} />
            <div className="sky-tracking-log-info">
              <TrackingLink to={trackerHref(metric.tracker.name)} navigate={navigate}>
                {metric.tracker.title}
              </TrackingLink>
              <p>
                {latest
                  ? latest.values.notes ||
                    `${logged.length > 1 ? logged.length + ' entries' : 'Logged'}${metric.tracker.ask === 'morning' && isToday ? ' this morning' : ''}`
                  : deferred
                    ? 'Set aside for later today'
                    : metric.tracker.question}
              </p>
            </div>
            {latest ? (
              <>
                <span className="sky-tracking-log-value">
                  {column && formatTrackingValue(column, latest.values[column.name])}
                </span>
                <TrackingIcon name="check" className="sky-tracking-saved" />
                {!readOnly && (
                  <ActionIcon
                    variant="secondary"
                    aria-label={`Edit ${metric.tracker.title}`}
                    onClick={() => open({ metric, date: day, entry: latest })}
                  >
                    <TrackingIcon name="edit" />
                  </ActionIcon>
                )}
              </>
            ) : !readOnly && report ? (
              deferred ? (
                <Button variant="primary-quiet" size="compact-sm" onClick={() => defer(metric.tracker.name, false)}>
                  Log now
                </Button>
              ) : (
                <div className="sky-tracking-log-actions">
                  {simple ? (
                    <InlineTrackingAnswer
                      metric={metric}
                      busy={actions.busy}
                      save={async (value, operationId) =>
                        !!(await actions.act(`${metric.tracker.title} saved · ${day}`, () =>
                          trackingRequest(`/${encodeURIComponent(metric.tracker.name)}/entries`, {
                            operationId,
                            revision: metric.tracker.revision,
                            date: day,
                            values: {
                              [answers[0].name]: value,
                              ...Object.fromEntries(
                                metric.tracker.columns
                                  .filter((c) => c.type === 'time')
                                  .map((c) => [c.name, report.time]),
                              ),
                            },
                          }),
                        ))
                      }
                    />
                  ) : (
                    <Button variant="primary" onClick={() => open({ metric, date: day })}>
                      Log entry
                    </Button>
                  )}
                  {isToday && (
                    <Button
                      variant="primary-quiet"
                      size="compact-sm"
                      disabled={actions.busy}
                      onClick={() => {
                        defer(metric.tracker.name, true)
                        actions.setNotice({
                          text: 'Set aside for later. No entry recorded.',
                          undo: async () => defer(metric.tracker.name, false),
                        })
                      }}
                    >
                      Later
                    </Button>
                  )}
                </div>
              )
            ) : (
              <span className="sky-tracking-missing">No entry</span>
            )}
          </div>
        )
      })}
      {evening.length > 0 && (
        <p className="sky-tracking-hint sky-tracking-day-later">
          Tonight · {evening.map((metric) => metric.tracker.title).join(', ')}
        </p>
      )}
      {!visible.length && !evening.length && !data.error && (
        <p className="sky-tracking-hint">
          {active.length ? 'Nothing to check in on right now.' : 'Start with one thing you want to understand better.'}
        </p>
      )}
      <div className="sky-tracking-day-footer">
        {!readOnly && (
          <Button
            variant="primary-quiet"
            size="compact-sm"
            leftSection={<TrackingIcon name="plus" />}
            onClick={() => (active.length ? setChooser(true) : navigate('/tracking/new'))}
          >
            {active.length ? 'Log something else' : 'Create a tracker'}
          </Button>
        )}
        <span className="sky-tracking-hint">
          For {isToday ? 'today · ' : ''}
          {day}
        </span>
      </div>
      {report?.errors.length ? (
        <p className="sky-tracking-error" role="status">
          {report.errors.length} {report.errors.length === 1 ? 'tracker needs' : 'trackers need'} attention.{' '}
          <TrackingLink to="/tracking" navigate={navigate}>
            View tracking
          </TrackingLink>
        </p>
      ) : null}
      <TrackingFeedback actions={actions} />
      <Modal opened={chooser} onClose={() => setChooser(false)} title="Log an entry" size={460} centered>
        <p className="sky-tracking-dialog-sub">Choose what you want to record for {day}.</p>
        <div className="sky-tracking-chooser">
          {active.map((metric) => (
            <Button
              key={metric.tracker.name}
              variant="secondary"
              fullWidth
              justify="space-between"
              rightSection={<TrackingIcon name="chevron" />}
              onClick={() => open({ metric, date: day })}
            >
              {metric.tracker.title}
            </Button>
          ))}
        </div>
      </Modal>
      {target && report && (
        <Fragment key={`${target.metric.tracker.name}:${target.entry?.id ?? 'new'}:${target.date}`}>
          <TrackingLogDialog
            target={target}
            time={report.time}
            canParse={report.canParse}
            actions={actions}
            onClose={() => setTarget(null)}
          />
        </Fragment>
      )}
    </section>
  )
}
