import { Button, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { describeOutboxScan, outboxScanSeverity } from '#lib/outbox/describeScan.ts'
import { dayRange, rangeLabel, ScanRangeSchema, type SavedScanRange } from '#lib/outbox/range.ts'
import type { OutboxReport, OutboxScanResult } from '../../outbox/mod.ts'
import { outboxRequest } from './outboxHooks.ts'
import { outboxLinkClick } from './outboxLink.tsx'
import { outboxHref } from './outboxRoutes.ts'
import { askedLabel, dateLabel } from './outboxTime.ts'

/**
 * The check: one quiet line saying how far Sky has read, the range fields
 * behind Change range, and the foot that lists what each conversation
 * came to.
 */

export type CheckSeverity = 'info' | 'warning' | 'error'

export function useOutboxCheck({
  report,
  refresh,
  setConnectionError,
  busy,
}: {
  report: OutboxReport | null
  refresh: () => Promise<void>
  setConnectionError: (value: boolean) => void
  /** Another action is running on the list; the check waits for it. */
  busy: boolean
}) {
  const [startingCheck, setStartingCheck] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<OutboxScanResult | null>(null)
  const [searchEdit, setSearchEdit] = useState<SavedScanRange | null>(null)
  const [rangeOpen, setRangeOpen] = useState(false)
  const checkInFlight = useRef(false)
  const search = searchEdit ?? report?.search
  const rangeValid = !search || ScanRangeSchema.safeParse(search.value).success
  const checking = startingCheck || report?.check?.running === true
  const progress = report?.check?.progress ?? null
  useEffect(() => {
    // A restart can lose the POST acknowledgement after saving its range. Reuse
    // the recovered revision without discarding a different unsaved selection.
    const saved = report?.search
    setSearchEdit((current) =>
      current && saved && current.value.start === saved.value.start && current.value.end === saved.value.end
        ? null
        : current,
    )
  }, [report?.search])
  const checkNow = async () => {
    if (busy || checking || checkInFlight.current || !rangeValid) return
    checkInFlight.current = true
    setStartingCheck(true)
    setScanFeedback(null)
    let accepted = false
    try {
      const result = await outboxRequest<OutboxScanResult>(
        '/scan',
        'POST',
        search ? { range: search.value, revision: search.revision } : {},
      )
      accepted = true
      if (!result.running)
        setScanFeedback({
          ...result,
          message:
            result.message ?? (result.outcome === 'failed' ? 'Sky could not complete this check.' : 'Check complete.'),
        })
    } catch (problem) {
      if (problem instanceof TypeError) setConnectionError(true)
      else
        setScanFeedback({
          outcome: 'failed',
          message: problem instanceof Error ? problem.message : 'Sky could not complete this check.',
        })
    } finally {
      await refresh().catch(() => setConnectionError(true))
      if (accepted) setSearchEdit(null)
      setStartingCheck(false)
      checkInFlight.current = false
    }
  }
  const scanResult = scanFeedback ?? report?.check?.result ?? null
  const severity: CheckSeverity = checking
    ? 'info'
    : scanResult
      ? (scanResult.severity ?? (scanResult.outcome === 'failed' ? 'error' : 'info'))
      : report?.lastScan
        ? outboxScanSeverity(report.lastScan)
        : 'info'
  const message =
    scanFeedback?.message ??
    report?.check?.result?.message ??
    (report?.lastScan ? describeOutboxScan(report.lastScan) : '')
  // The last finished check, for the line: the job's own summary, else the saved one.
  const summary = progress && progress.status !== 'running' ? progress : (report?.lastScan ?? progress)
  return {
    report,
    search,
    rangeValid,
    checking,
    progress,
    severity,
    message,
    summary,
    hasChecked: Boolean(summary || scanResult),
    rangeOpen,
    setRangeOpen,
    setSearchEdit,
    checkNow,
    busy,
  }
}

export type OutboxCheckState = ReturnType<typeof useOutboxCheck>

/** What the line says: how far the check has read, and what it could not read. */
function checkLine(check: OutboxCheckState): string {
  const { checking, progress, summary } = check
  if (checking) {
    if (progress?.status !== 'running') return 'Finding saved Slack and email conversations in your range…'
    const prepared = progress.prepared ? ` ${progress.prepared} need your review.` : ''
    return `Checking saved conversations… ${progress.completed} of ${progress.total} checked.${prepared}`
  }
  if (!summary) return 'Not checked yet'
  const parts: string[] = []
  if (summary.range) parts.push(`Checked through ${askedLabel(summary.range.end.replace('T', ' '))}`)
  else if (summary.date) parts.push(`Checked ${dateLabel(summary.date)}`)
  else parts.push('Checked')
  if (summary.failed)
    parts.push(`${summary.failed} ${summary.failed === 1 ? 'conversation' : 'conversations'} could not be checked`)
  const unchecked =
    summary.total !== undefined && summary.completed !== undefined ? Math.max(0, summary.total - summary.completed) : 0
  if (unchecked) parts.push(`${unchecked} still to check`)
  return parts.join(' · ')
}

/** The check line, with its range fields folded beneath it. */
export function OutboxCheckLine({ check }: { check: OutboxCheckState }) {
  const { report, search, rangeValid, checking, severity, message, rangeOpen, setRangeOpen, setSearchEdit, busy } =
    check
  if (!report?.automation) return null
  const failed = severity === 'error'
  return (
    <div className="sky-outbox-check">
      <div
        className={failed ? 'sky-outbox-notice' : 'sky-outbox-check-line'}
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
        aria-atomic="true"
        data-checking={checking}
        data-severity={severity}
      >
        <span className="sky-outbox-check-text">{failed ? message : checkLine(check)}</span>
        {!rangeOpen &&
          (checking ? (
            <Button size="compact-sm" variant="primary-quiet" loading disabled>
              Checking…
            </Button>
          ) : (
            <Button size="compact-sm" variant="primary-quiet" disabled={busy} onClick={() => void check.checkNow()}>
              {check.hasChecked ? 'Check again' : 'Check now'}
            </Button>
          ))}
        <Button
          size="compact-sm"
          variant="primary-quiet"
          aria-expanded={rangeOpen}
          onClick={() => setRangeOpen(!rangeOpen)}
        >
          Change range
        </Button>
      </div>
      {rangeOpen && search && (
        <section className="sky-outbox-range" aria-label="Search range">
          <div className="sky-outbox-range-fields">
            <TextInput
              size="md"
              type="datetime-local"
              label="From"
              value={search.value.start}
              disabled={checking || busy}
              onChange={(event) =>
                setSearchEdit({ ...search, value: { ...search.value, start: event.currentTarget.value } })
              }
            />
            <TextInput
              size="md"
              type="datetime-local"
              label="Through"
              value={search.value.end}
              disabled={checking || busy}
              onChange={(event) =>
                setSearchEdit({ ...search, value: { ...search.value, end: event.currentTarget.value } })
              }
            />
            <Button
              variant="primary"
              loading={checking}
              disabled={checking || !rangeValid || busy}
              onClick={() => void check.checkNow()}
            >
              {checking ? 'Checking…' : 'Check now'}
            </Button>
            {report.today && (
              <Button
                disabled={checking || busy}
                onClick={() => setSearchEdit({ ...search, value: dayRange(report.today!) })}
              >
                Today
              </Button>
            )}
          </div>
          {!rangeValid && <p role="alert">Choose valid dates and times, with the end on or after the start.</p>}
          <p className="sky-outbox-meta">
            Slack and email · Times as shown in your saved messages. Your range stays fixed after Check now; later
            replies provide context.
          </p>
        </section>
      )}
    </div>
  )
}

/** The foot of the list: what Sky checked, conversation by conversation. */
export function OutboxCheckFoot({
  check,
  open,
  navigate,
}: {
  check: OutboxCheckState
  open: (id: string) => void
  navigate: (path: string) => void
}) {
  const { report, progress, message } = check
  if (!report?.automation) return null
  const checks = progress?.checks ?? []
  return (
    <details className="sky-outbox-checks">
      <summary>
        What Sky checked{progress ? ` · ${progress.range ? rangeLabel(progress.range) : progress.date}` : ''}
      </summary>
      <p className="sky-outbox-meta">
        Saved Slack and email conversations ·{' '}
        {report.automation.status === 'paused' ? 'Automatic checks paused' : 'Checks every 5 minutes'}
        {report.lastScan ? ` · Last checked ${report.lastScan.at} UTC` : ''}
      </p>
      {message && <p>{message}</p>}
      {report.modelLabel && (
        <p className="sky-outbox-meta">
          Checked with <span>{report.modelLabel}</span>
        </p>
      )}
      <Button size="compact-sm" onClick={() => navigate(`/automations/${report.automation!.name}`)}>
        System automation
      </Button>
      {checks.length > 0 && (
        <ul>
          {checks.map((entry) => (
            <li key={entry.key}>
              <strong>{entry.title}</strong>
              <div className="sky-outbox-meta">
                {entry.medium ?? 'Saved message'} ·{' '}
                {entry.disposition === 'answered'
                  ? 'Already answered'
                  : entry.disposition === 'ignored'
                    ? 'No reply needed'
                    : entry.disposition === 'failed'
                      ? 'Could not check'
                      : entry.disposition === 'preserved'
                        ? 'Existing review preserved'
                        : 'Needs review'}
                {entry.model ? ` · ${entry.model}` : ''}
              </div>
              <p>{entry.reason}</p>
              {entry.limitations?.map((limitation) => (
                <p key={limitation} className="sky-outbox-notice">
                  {limitation}
                </p>
              ))}
              {entry.itemId && report.items.some((item) => item.id === entry.itemId) && (
                <Button
                  size="compact-sm"
                  component="a"
                  href={outboxHref(entry.itemId)}
                  onClick={outboxLinkClick(open, entry.itemId)}
                >
                  Open review
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
