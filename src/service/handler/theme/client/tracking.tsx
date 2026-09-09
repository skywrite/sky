import { ActionIcon, Button, Menu, NativeSelect, TextInput } from '@mantine/core'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { TrackingMetric, TrackingReport } from '#lib/tracking/types.ts'
import {
  formatTrackingValue,
  isTrackingDay,
  primaryTrackingColumn,
  trackingSeries,
  trackingSummary,
} from '#lib/tracking/values.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { stageChatDraft } from './chatDraft.ts'
import { fileHref } from './explorer.tsx'
import { TrackingChart } from './trackingChart.tsx'
import { trackingRequest, useTrackingActions, useTrackingReport } from './trackingData.ts'
import { TrackingEntries } from './trackingEntries.tsx'
import { TrackingLogDialog, type TrackingLogTarget } from './trackingLog.tsx'
import { TrackingSetup } from './trackingSetup.tsx'
import {
  answerLabel,
  trackerHref,
  TrackerSymbol,
  TrackingFeedback,
  TrackingIcon,
  TrackingLink,
  trackingPurpose,
} from './trackingShared.tsx'
import './tracking.css'

const periods = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]
const order = { morning: 0, evening: 1, anytime: 2 }

function TrackingCard({
  metric,
  report,
  navigate,
  onLog,
}: {
  metric: TrackingMetric
  report: TrackingReport
  navigate: (path: string) => void
  onLog: (target: TrackingLogTarget) => void
}) {
  const { tracker } = metric,
    column = primaryTrackingColumn(tracker)
  const points = column ? trackingSeries(metric.entries, column, report.start, report.end) : []
  const summary = column ? trackingSummary(points, column) : null
  const today = metric.entries.filter((entry) => entry.date === report.today)
  const prompted = tracker.question && isTrackingDay(tracker, report.today) && tracker.ask !== 'anytime'
  return (
    <article className="sky-tracking-card">
      <div className="sky-tracking-card-heading">
        <TrackerSymbol tracker={tracker} />
        <TrackingLink to={trackerHref(tracker.name)} navigate={navigate}>
          <h3>{tracker.title}</h3>
          <p>{tracker.category || 'Tracking'}</p>
        </TrackingLink>
        <TrackingLink
          to={trackerHref(tracker.name)}
          navigate={navigate}
          className="sky-tracking-card-open"
          label={`View ${tracker.title} history`}
        >
          <TrackingIcon name="chevron" />
        </TrackingLink>
      </div>
      <TrackingLink to={trackerHref(tracker.name)} navigate={navigate} className="sky-tracking-card-chart">
        <div className="sky-tracking-card-value">{column ? formatTrackingValue(column, summary?.value) : '—'}</div>
        <p className="sky-tracking-hint">
          {summary?.value !== null
            ? `${summary?.label ?? 'No entries'} · ${summary?.days ?? 0} days logged`
            : 'No entries in this range'}
        </p>
        {column && summary?.average !== null && summary?.average !== undefined && summary.label !== 'Daily average' && (
          <p className="sky-tracking-hint" title="Average across days with recorded values; missing days are excluded.">
            Daily average · {formatTrackingValue(column, summary.average)}
          </p>
        )}
        {column && <TrackingChart points={points} column={column} compact />}
      </TrackingLink>
      <div className="sky-tracking-card-footer">
        <span>
          {tracker.status === 'archived' ? (
            'Archived'
          ) : today.length ? (
            <>
              <TrackingIcon name="check" className="sky-tracking-saved" /> Logged today
            </>
          ) : prompted && tracker.ask === 'morning' ? (
            <span className="sky-tracking-accent">Ready to log</span>
          ) : prompted && tracker.ask === 'evening' ? (
            'Evening check-in'
          ) : (
            'Log when you choose'
          )}
        </span>
        {tracker.status === 'active' && (
          <Button variant="primary-quiet" size="compact-sm" onClick={() => onLog({ metric, date: report.today })}>
            {today.length ? 'Log another' : 'Log entry'}
          </Button>
        )}
      </div>
    </article>
  )
}

function discussion(metric: TrackingMetric, report: TrackingReport): string {
  const selected = metric.entries.slice(-200)
  const fields = [
    ...new Set([
      ...metric.tracker.columns.map((column) => column.name),
      ...selected.flatMap((entry) => Object.keys(entry.values)),
    ]),
  ]
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const rows = [
    ['date', ...fields],
    ...selected.map((entry) => [entry.date, ...fields.map((field) => entry.values[field] ?? '')]),
  ]
    .map((row) => row.map(quote).join(', '))
    .join('\n')
  return `Help me reflect on my ${metric.tracker.title.toLowerCase()} tracking from ${report.start} to ${report.end}. Look for useful patterns and missing context; distinguish observations from possible explanations.\n\nWhy I track this:\n${metric.tracker.markdown}\n\nFields: ${metric.tracker.columns.map((column) => `${column.name}${column.unit ? ` (${column.unit})` : ''}`).join(', ')}\n\n${selected.length} of ${metric.entries.length} entries in this range${selected.length < metric.entries.length ? ' (most recent)' : ''}:\n\n\`\`\`csv\n${rows}\n\`\`\`\n\nNotebook sources:\n${[metric.tracker.path, ...new Set(metric.entries.map((entry) => entry.source))].map((source) => `- ${source}`).join('\n')}`
}

export function TrackingMain({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const segment = path.slice('/tracking'.length).replace(/^\//, '')
  const creating = segment === 'new'
  const editing = !creating && segment.endsWith('/edit')
  let name: string | null = null
  try {
    name = segment && !creating ? decodeURIComponent(editing ? segment.slice(0, -5) : segment) : null
  } catch {
    name = segment
  }
  const [period, setPeriod] = useState('30')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [applied, setApplied] = useState({ start: '', end: '' })
  const [view, setView] = useState('trends')
  const [status, setStatus] = useState('active')
  const [columnName, setColumnName] = useState('')
  const [target, setTarget] = useState<TrackingLogTarget | null>(null)
  const query = new URLSearchParams({
    days: period === 'custom' ? '30' : period,
    ...(name ? { name } : {}),
    ...(period === 'custom' && applied.start && applied.end ? applied : {}),
  }).toString()
  const data = useTrackingReport(query)
  const actions = useTrackingActions(data.refresh)
  const { report } = data
  const selected = report?.metrics.find((metric) => metric.tracker.name === name)
  const column =
    selected?.tracker.columns.find((candidate) => candidate.name === columnName) ??
    (selected ? primaryTrackingColumn(selected.tracker) : undefined)
  const points = useMemo(
    () => (selected && column && report ? trackingSeries(selected.entries, column, report.start, report.end) : []),
    [selected, column, report],
  )
  const summary = column ? trackingSummary(points, column) : null
  const latest = selected?.entries.at(-1)
  useEffect(() => {
    setTarget(null)
    actions.setError('')
  }, [path])
  const onLog = (next: TrackingLogTarget) => {
    actions.setError('')
    setTarget(next)
  }
  const setRange = (value: string) => {
    if (value === 'custom' && report) {
      setCustom({ start: report.start, end: report.end })
      setApplied({ start: report.start, end: report.end })
    }
    setPeriod(value)
  }
  const rangeControl = (
    <NativeSelect
      aria-label="Date range"
      value={period}
      onChange={(event) => setRange(event.currentTarget.value)}
      data={periods}
      size="sm"
    />
  )
  const customControl = period === 'custom' && (
    <form
      className="sky-tracking-custom-range"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(custom.start) || !/^\d{4}-\d{2}-\d{2}$/.test(custom.end))
            throw new Error('Use YYYY-MM-DD for both dates.')
          new PlainDate(custom.start)
          new PlainDate(custom.end)
          if (custom.start > custom.end) throw new Error('The start date must be before the end date.')
          setApplied(custom)
          actions.setError('')
        } catch (problem) {
          actions.setError((problem as Error).message)
        }
      }}
    >
      <TextInput
        label="From"
        aria-label="Range start"
        value={custom.start}
        onChange={(event) => setCustom((current) => ({ ...current, start: event.currentTarget.value }))}
        placeholder="YYYY-MM-DD"
      />
      <TextInput
        label="Through"
        aria-label="Range end"
        value={custom.end}
        onChange={(event) => setCustom((current) => ({ ...current, end: event.currentTarget.value }))}
        placeholder="YYYY-MM-DD"
      />
      <Button variant="primary" type="submit">
        Apply
      </Button>
    </form>
  )
  const active = report?.metrics.filter((metric) => metric.tracker.status === 'active') ?? []
  const metrics =
    report?.metrics
      .filter((metric) => metric.tracker.status === status)
      .sort((a, b) => order[a.tracker.ask] - order[b.tracker.ask] || a.tracker.title.localeCompare(b.tracker.title)) ??
    []
  const due = report
    ? active.filter(
        (metric) =>
          metric.tracker.question &&
          isTrackingDay(metric.tracker, report.today) &&
          metric.tracker.ask !== 'anytime' &&
          (report.window === 'evening' || metric.tracker.ask === 'morning') &&
          !metric.entries.some((entry) => entry.date === report.today),
      )
    : []
  return (
    <div className="sky-main sky-tracking">
      <div className="sky-scroll">
        <div className="sky-tracking-col">
          {data.error && (
            <div className="sky-tracking-error" role="alert">
              {data.error}{' '}
              <Button variant="secondary" size="compact-sm" onClick={() => void data.refresh()}>
                Retry
              </Button>
            </div>
          )}
          {!report ? (
            !data.error && (
              <p className="sky-tracking-hint" role="status">
                Loading tracking…
              </p>
            )
          ) : creating || (editing && selected) ? (
            <Fragment key={selected?.tracker.name ?? 'new'}>
              <TrackingSetup
                tracker={editing ? selected?.tracker : undefined}
                today={report.today}
                actions={actions}
                onCreated={(created) => navigate(trackerHref(created))}
                navigate={navigate}
              />
            </Fragment>
          ) : name && selected ? (
            <>
              <div className="sky-tracking-breadcrumb">
                <TrackingLink to="/tracking" navigate={navigate}>
                  Tracking
                </TrackingLink>
                <TrackingIcon name="chevron" />
                <span>{selected.tracker.title}</span>
              </div>
              <header className="sky-tracking-heading">
                <div>
                  <h1>{selected.tracker.title}</h1>
                  <p>
                    {trackingPurpose(selected.tracker.markdown) || selected.tracker.question}
                    {selected.tracker.status === 'archived' && <span className="sky-tracking-tag">Archived</span>}
                  </p>
                </div>
                <div className="sky-tracking-row">
                  {selected.tracker.status === 'active' && (
                    <Button
                      variant="primary"
                      leftSection={<TrackingIcon name="plus" />}
                      onClick={() => onLog({ metric: selected, date: report.today })}
                    >
                      Log entry
                    </Button>
                  )}
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="secondary" aria-label="Tracker settings">
                        <TrackingIcon name="dots" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => navigate(`${trackerHref(selected.tracker.name)}/edit`)}>
                        Edit tracker
                      </Menu.Item>
                      <Menu.Item component="a" href={fileHref(selected.tracker.path)}>
                        Open definition file
                      </Menu.Item>
                      <Menu.Item
                        disabled={actions.busy}
                        onClick={() =>
                          void actions.act(
                            selected.tracker.status === 'active'
                              ? 'Tracker archived. History is preserved.'
                              : 'Tracker restored.',
                            () =>
                              trackingRequest(`/${encodeURIComponent(selected.tracker.name)}/status`, {
                                operationId: crypto.randomUUID(),
                                revision: selected.tracker.revision,
                                status: selected.tracker.status === 'active' ? 'archived' : 'active',
                              }),
                          )
                        }
                      >
                        {selected.tracker.status === 'active' ? 'Archive tracker' : 'Restore tracker'}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
              </header>
              {column && (
                <>
                  <div className="sky-tracking-stats">
                    <div>
                      <span>{summary?.label}</span>
                      <strong className="sky-tracking-stat-hero">{formatTrackingValue(column, summary?.value)}</strong>
                    </div>
                    <div>
                      {summary?.average !== null &&
                      summary?.average !== undefined &&
                      summary.label !== 'Daily average' ? (
                        <>
                          <span title="Average across days with recorded values; missing days are excluded.">
                            Daily average
                          </span>
                          <strong>{formatTrackingValue(column, summary.average)}</strong>
                          <p className="sky-tracking-hint">
                            Latest · {formatTrackingValue(column, latest?.values[column.name])}
                            {latest ? ` · ${latest.date}` : ''}
                          </p>
                        </>
                      ) : (
                        <>
                          <span>Latest in range{latest ? ` · ${latest.date}` : ''}</span>
                          <strong>{formatTrackingValue(column, latest?.values[column.name])}</strong>
                        </>
                      )}
                    </div>
                    <div>
                      <span>In this range</span>
                      <strong>
                        {selected.entries.length} <small>entries</small>
                      </strong>
                      <p className="sky-tracking-hint">{summary?.days ?? 0} days logged</p>
                    </div>
                  </div>
                  <section className="sky-tracking-chart-card">
                    <div className="sky-tracking-chart-heading">
                      {selected.tracker.columns.filter((c) => c.name !== 'notes').length > 1 ? (
                        <NativeSelect
                          aria-label="Chart answer"
                          value={column.name}
                          data={selected.tracker.columns
                            .filter((c) => c.name !== 'notes')
                            .map((c) => ({ value: c.name, label: answerLabel(c.name) }))}
                          onChange={(event) => setColumnName(event.currentTarget.value)}
                          size="sm"
                        />
                      ) : (
                        <h3>{answerLabel(column.name)} over time</h3>
                      )}
                      <span className="sky-tracking-legend">
                        <i />
                        {column.aggregate === 'sum'
                          ? 'Daily total'
                          : column.aggregate === 'mean'
                            ? 'Daily average'
                            : column.aggregate === 'collect'
                              ? 'Individual answers'
                              : 'Daily entry'}
                      </span>
                      {rangeControl}
                    </div>
                    {customControl}
                    <TrackingChart points={points} column={column} />
                    <p className="sky-tracking-chart-note">
                      {column.aggregate === 'sum'
                        ? 'Multiple entries on a day are added together.'
                        : column.aggregate === 'mean'
                          ? 'Each point averages the recorded values for that day.'
                          : column.aggregate === 'collect'
                            ? 'Answers remain separate in the history below.'
                            : 'Each point is the last answer recorded for that day.'}{' '}
                      Gaps mean no entry.
                      {summary?.average !== null && summary?.average !== undefined
                        ? ' Averages exclude missing days.'
                        : ''}
                    </p>
                  </section>
                </>
              )}
              {selected.warnings.length > 0 && (
                <div className="sky-tracking-error" role="status">
                  {selected.warnings.join(' ')}
                </div>
              )}
              <div className="sky-tracking-entries-heading">
                <h2>Entries</h2>
                <Button
                  component="a"
                  variant="primary-quiet"
                  size="sm"
                  href={`/tracking/_api/${encodeURIComponent(selected.tracker.name)}/export?${new URLSearchParams(period === 'all' ? { days: 'all' } : { start: report.start, end: report.end })}`}
                  download
                  leftSection={<TrackingIcon name="download" />}
                >
                  Export
                </Button>
              </div>
              <Fragment key={`${name}:${report.start}:${report.end}`}>
                <TrackingEntries
                  metrics={[selected]}
                  start={report.start}
                  end={report.end}
                  showMissing
                  onLog={onLog}
                  navigate={navigate}
                />
              </Fragment>
              <div className="sky-tracking-reflection">
                <TrackingIcon name="chat" />
                <div>
                  <h3>Make sense of the pattern</h3>
                  <p className="sky-tracking-hint">Bring these entries and notes into a conversation.</p>
                </div>
                <Button
                  variant="primary"
                  disabled={!selected.entries.length}
                  onClick={() => {
                    const id = crypto.randomUUID()
                    stageChatDraft(id, discussion(selected, report))
                    navigate(`/thread/${id}`)
                  }}
                >
                  Discuss with Sky
                </Button>
              </div>
            </>
          ) : name ? (
            <div className="sky-tracking-empty">
              <h2>{data.loading ? 'Loading tracker…' : 'Tracker unavailable'}</h2>
              <p>{report.errors.find((error) => error.name === name)?.message}</p>
              <Button variant="primary" onClick={() => navigate('/tracking')}>
                Back to tracking
              </Button>
            </div>
          ) : (
            <>
              <header className="sky-tracking-heading">
                <div>
                  <h1>Tracking</h1>
                  <p>Your metrics, over time.</p>
                </div>
                <Button
                  variant="primary"
                  leftSection={<TrackingIcon name="plus" />}
                  onClick={() => navigate('/tracking/new')}
                >
                  New tracker
                </Button>
              </header>
              {status === 'active' && active.length > 0 && report.end === report.today && (
                <section className="sky-tracking-checkin">
                  <span className="sky-tracking-checkin-icon">
                    <TrackingIcon name={due.length ? (report.window === 'morning' ? 'sun' : 'moon') : 'check'} />
                  </span>
                  <div>
                    <h3>
                      {due.length
                        ? report.window === 'morning'
                          ? 'A moment for your morning'
                          : 'A moment for your evening'
                        : 'Your check-in is complete'}
                    </h3>
                    <p>
                      {due.length
                        ? `${due.length === 1 ? due[0].tracker.title + ' is' : due.length + ' trackers are'} ready to log.${report.window === 'morning' && active.some((metric) => metric.tracker.ask === 'evening') ? ' Your next check-in is this evening.' : ''}`
                        : 'Your entries are saved. You can always log another.'}
                    </p>
                  </div>
                  {due.length > 0 && (
                    <Button variant="primary" onClick={() => onLog({ metric: due[0], date: report.today })}>
                      {due.length === 1 ? `Log ${due[0].tracker.title.toLowerCase()}` : 'Check in'}
                    </Button>
                  )}
                </section>
              )}
              <div className="sky-tracking-toolbar">
                <div className="sky-tracking-tabs" role="tablist" aria-label="Tracking view">
                  <button type="button" role="tab" aria-selected={view === 'trends'} onClick={() => setView('trends')}>
                    Trends
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'entries'}
                    onClick={() => setView('entries')}
                  >
                    Entries
                  </button>
                </div>
                <NativeSelect
                  aria-label="Tracker status"
                  size="sm"
                  value={status}
                  onChange={(event) => setStatus(event.currentTarget.value)}
                  data={[
                    { value: 'active', label: `Active (${active.length})` },
                    { value: 'archived', label: `Archived (${report.metrics.length - active.length})` },
                  ]}
                />
                {rangeControl}
              </div>
              {customControl}
              {metrics.length ? (
                view === 'trends' ? (
                  <>
                    <div className="sky-tracking-grid">
                      {metrics.map((metric) => (
                        <Fragment key={metric.tracker.name}>
                          <TrackingCard metric={metric} report={report} navigate={navigate} onLog={onLog} />
                        </Fragment>
                      ))}
                    </div>
                    <p className="sky-tracking-footnote">
                      <TrackingIcon name="file" />
                      Missing entries stay blank. Log or correct any day from a tracker’s history.
                    </p>
                  </>
                ) : (
                  <Fragment key={`${report.start}:${report.end}:${status}`}>
                    <TrackingEntries
                      metrics={metrics}
                      start={report.start}
                      end={report.end}
                      onLog={onLog}
                      navigate={navigate}
                    />
                  </Fragment>
                )
              ) : (
                <div className="sky-tracking-empty">
                  <h2>{status === 'archived' ? 'No archived trackers' : 'What would you like to notice?'}</h2>
                  <p>
                    {status === 'archived'
                      ? 'A tracker’s history stays available after you archive it.'
                      : 'Start with one thing you want to understand better.'}
                  </p>
                  {status === 'active' && (
                    <Button variant="primary" onClick={() => navigate('/tracking/new')}>
                      Create your first tracker
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {report?.errors.length && !name ? (
            <div className="sky-tracking-error" role="alert">
              {report.errors.map((error) => (
                <p key={error.name}>
                  {error.name}: {error.message}
                </p>
              ))}
            </div>
          ) : null}
          <TrackingFeedback actions={actions} />
        </div>
      </div>
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
    </div>
  )
}
