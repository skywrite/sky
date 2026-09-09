import { ActionIcon, Button } from '@mantine/core'
import { useState } from 'react'
import type { TrackingEntry, TrackingMetric } from '#lib/tracking/types.ts'
import { formatTrackingValue, isTrackingDay, primaryTrackingColumn } from '#lib/tracking/values.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { TrackingLogTarget } from './trackingLog.tsx'
import { answerLabel, trackerHref, TrackingIcon, TrackingLink } from './trackingShared.tsx'

export function TrackingEntries({
  metrics,
  start,
  end,
  showMissing = false,
  onLog,
  navigate,
}: {
  metrics: TrackingMetric[]
  start: string
  end: string
  showMissing?: boolean
  onLog: (target: TrackingLogTarget) => void
  navigate: (path: string) => void
}) {
  const [limit, setLimit] = useState(30)
  const detail = metrics.length === 1 && showMissing
  const metric = metrics[0]
  const records: Array<{ metric: TrackingMetric; date: string; entry?: TrackingEntry }> = metrics.flatMap((item) =>
    item.entries
      .slice()
      .reverse()
      .map((entry) => ({ metric: item, date: entry.date, entry })),
  )
  if (detail && metric) {
    const recorded = new Set(metric.entries.map((entry) => entry.date))
    for (let day = new PlainDate(end); day.ymd >= start; day = day.addDays(-1)) {
      if (!recorded.has(day.ymd) && isTrackingDay(metric.tracker, day.ymd)) records.push({ metric, date: day.ymd })
    }
  }
  records.sort((a, b) => b.date.localeCompare(a.date))
  const columns: TrackingColumn[] = detail ? [...metric.tracker.columns] : []
  if (detail)
    for (const name of new Set(metric.entries.flatMap((entry) => Object.keys(entry.values)))) {
      if (!columns.some((column) => column.name === name)) columns.push({ name, type: 'text' })
    }
  const visible = records.slice(0, limit)
  return (
    <>
      {!records.length ? (
        <div className="sky-tracking-empty">
          <h3>No entries in this range</h3>
          <p>Choose another range or record an observation.</p>
          {metric && metric.tracker.status === 'active' && (
            <Button variant="primary" onClick={() => onLog({ metric, date: end })}>
              Log entry
            </Button>
          )}
        </div>
      ) : (
        <div className="sky-tracking-table-scroll">
          <table className="sky-tracking-table">
            <thead>
              <tr>
                <th>Date</th>
                {detail ? (
                  columns.map((column) => (
                    <th key={column.name}>
                      {answerLabel(column.name)}
                      {column.unit && <small> {column.unit}</small>}
                    </th>
                  ))
                ) : (
                  <>
                    <th>Tracker</th>
                    <th>Entry</th>
                    <th>Notes</th>
                  </>
                )}
                <th>
                  <span className="sky-tracking-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ metric: item, date, entry }) => (
                <tr key={entry?.key ?? entry?.id ?? `${item.tracker.name}:${date}`}>
                  <td className="sky-tracking-date">
                    <time dateTime={date}>{date}</time>
                  </td>
                  {detail ? (
                    columns.map((column, index) => (
                      <td key={column.name} className={column.type === 'text' ? 'sky-tracking-entry-note' : undefined}>
                        {entry ? (
                          formatTrackingValue(column, entry.values[column.name])
                        ) : index === 0 ? (
                          <span className="sky-tracking-missing">No entry</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    ))
                  ) : (
                    <>
                      <td>
                        <TrackingLink to={trackerHref(item.tracker.name)} navigate={navigate}>
                          {item.tracker.title}
                        </TrackingLink>
                      </td>
                      <td>
                        {primaryTrackingColumn(item.tracker) &&
                          formatTrackingValue(
                            primaryTrackingColumn(item.tracker)!,
                            entry?.values[primaryTrackingColumn(item.tracker)!.name],
                          )}
                      </td>
                      <td className="sky-tracking-entry-note">{entry?.values.notes || '—'}</td>
                    </>
                  )}
                  <td>
                    {entry ? (
                      <ActionIcon
                        variant="secondary"
                        size="md"
                        aria-label={`Edit ${item.tracker.title} on ${date}`}
                        onClick={() => onLog({ metric: item, date, entry })}
                      >
                        <TrackingIcon name="edit" />
                      </ActionIcon>
                    ) : (
                      item.tracker.status === 'active' && (
                        <Button
                          variant="primary-quiet"
                          size="compact-sm"
                          aria-label={`Add ${item.tracker.title} on ${date}`}
                          onClick={() => onLog({ metric: item, date })}
                        >
                          Add
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {records.length > limit && (
        <Button variant="secondary" className="sky-tracking-load-more" onClick={() => setLimit((value) => value + 50)}>
          Show more · {records.length - limit} remaining
        </Button>
      )}
    </>
  )
}
