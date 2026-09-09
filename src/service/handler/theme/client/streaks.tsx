import { ActionIcon, Button, Menu, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { StreakReport, StreakView } from '../../streaks/types.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import {
  StreakCompactCalendars,
  StreakDetailedCalendar,
  StreakHistory,
  StreakLegend,
  StreakMarks,
  StreakPeriodControls,
  type StreakDayTarget,
} from './streaksCalendar.tsx'
import { useStreaksActions, useStreaksReport, type StreaksActions } from './streaksData.ts'
import {
  streakDayLabels,
  streakDayState,
  streakEmptyPeriod,
  streakMonth,
  streakPeriod,
  streakPeriodSummary,
  streakTracked,
  type StreakPeriod,
  type StreakScope,
} from './streaksDates.ts'
import { StreakCheck, StreakIcon, StreakLink, StreaksFeedback, streakFileHref, streakHref } from './streaksShared.tsx'
import { renderStatic } from './wysiwyg/render.ts'
import './streaks.css'

type Navigate = (path: string) => void

function completion(actions: StreaksActions, streak: StreakView, date: string) {
  const done = streak.done.includes(date)
  return actions.act(`/${encodeURIComponent(streak.name)}/completion`, { date, done: !done, expectedDone: done })
}

function dayWritable(report: StreakReport, date: string): boolean {
  return date <= report.today && report.days.some((day) => day.date === date && !day.ended)
}

function ambiguousStreak(report: StreakReport, streak: StreakView): boolean {
  return report.streaks.some(
    (other) =>
      other.relativePath !== streak.relativePath &&
      (other.name === streak.name || other.title.trim().toLowerCase() === streak.title.trim().toLowerCase()),
  )
}

function StreakNarrative({ markdown, html, className = '' }: { markdown: string; html?: string; className?: string }) {
  const content = useMemo(() => html ?? renderStatic(markdown), [html, markdown])
  return <RenderedHtml html={content} className={`sky-streaks-prose ${className}`} />
}

function habitCaption(streak: StreakView, date: string, today: string): string {
  if (streak.status === 'archived') return streak.end ? `Ended ${streak.end}` : 'Archived'
  if (!streak.start) return 'Add a start date in the streak document'
  if (streak.start > date) return `Starts ${streak.start}`
  if (streak.end && streak.end < date) return `Ended ${streak.end}`
  if (streak.done.includes(date)) return date === today ? 'Done today' : 'Completed'
  if (!streakTracked(streak, new PlainDate(date))) return date === today ? 'Not scheduled today' : 'Not scheduled'
  return streak.schedule === 'weekdays' ? 'Every weekday' : 'Every day'
}

function HabitRows({
  streaks,
  report,
  actions,
  onNavigate,
  href,
  onDay,
  compact = false,
  date = report.today,
  ended = false,
}: {
  streaks: StreakView[]
  report: StreakReport
  actions: StreaksActions
  onNavigate: Navigate
  href: (streak: StreakView) => string
  onDay: (target: StreakDayTarget) => void
  compact?: boolean
  date?: string
  ended?: boolean
}) {
  const writable = !ended && dayWritable(report, date)
  return (
    <div className={`sky-streaks-habit-rows${compact ? ' sky-streaks-compact' : ''}`}>
      {!compact && (
        <div className="sky-streaks-habit-columns">
          <span>Habit</span>
          <span>Last 14 days</span>
          <span>{streaks.every((streak) => streak.status === 'archived') ? 'Final streak' : 'Current streak'}</span>
        </div>
      )}
      {streaks
        .toSorted((a, b) => b.current - a.current)
        .map((streak) => (
          <div className="sky-streaks-habit-row" key={streak.relativePath}>
            <div className="sky-streaks-habit-main">
              <StreakCheck
                streak={streak}
                date={date}
                today={report.today}
                disabled={
                  actions.busy ||
                  ambiguousStreak(report, streak) ||
                  !writable ||
                  !streakTracked(streak, new PlainDate(date)) ||
                  (date === report.today && streak.status === 'archived')
                }
                onClick={() => void completion(actions, streak, date)}
              />
              <StreakLink className="sky-streaks-habit-title" href={href(streak)} onNavigate={onNavigate}>
                <span>{streak.title}</span>
                <small>{habitCaption(streak, date, report.today)}</small>
              </StreakLink>
            </div>
            {!compact && <StreakMarks streak={streak} today={report.today} onDay={onDay} />}
            <StreakLink className="sky-streaks-habit-run" href={href(streak)} onNavigate={onNavigate}>
              <span>
                {date === report.today ? (
                  <>
                    <b>{streak.current}</b> {streak.current === 1 ? 'day' : 'days'}
                  </>
                ) : (
                  'History'
                )}
                <StreakIcon name="right" size={16} />
              </span>
              {!compact && <small>Best {streak.best} days</small>}
            </StreakLink>
          </div>
        ))}
    </div>
  )
}

function StreakDayDialog({
  target,
  report,
  actions,
  onClose,
  onNavigate,
}: {
  target: StreakDayTarget | null
  report: StreakReport
  actions: StreaksActions
  onClose: () => void
  onNavigate: Navigate
}) {
  const streak = report.streaks.find((value) => value.name === target?.name)
  const date = target ? new PlainDate(target.date) : null
  const day = report.days.find((value) => value.date === target?.date)
  const state = streak && date ? streakDayState(streak, date, report.today) : null
  const mutable =
    !!target &&
    !!state &&
    !!streak &&
    !ambiguousStreak(report, streak) &&
    !['off', 'future'].includes(state) &&
    dayWritable(report, target.date)
  const message =
    state === 'off'
      ? 'This date is outside the habit’s schedule.'
      : state === 'future'
        ? 'This day hasn’t happened yet.'
        : day?.ended
          ? 'This day has ended. Its record is read-only.'
          : !day
            ? 'There is no day record for this date. Start the day in Today before checking in.'
            : state === 'done'
              ? 'This completion is part of the day’s record.'
              : state === 'pending'
                ? 'Today is still open. Complete the habit whenever you’re ready.'
                : 'No completion was recorded for this day.'
  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      title={target?.date}
      size="sm"
      closeOnClickOutside={!actions.busy}
      closeOnEscape={!actions.busy}
    >
      {streak && date && state && (
        <div className="sky-streaks-modal sky-streaks-day-dialog">
          <h2>{streak.title}</h2>
          <p className="sky-streaks-day-status" data-state={state}>
            {streakDayLabels[state]}
          </p>
          <p>{message}</p>
          {actions.error && (
            <p className="sky-streaks-form-error" role="alert">
              {actions.error}
            </p>
          )}
          <div className="sky-streaks-dialog-stack">
            {mutable && (
              <Button
                variant={state === 'done' ? 'secondary' : 'primary'}
                loading={actions.busy}
                onClick={async () => {
                  if (await completion(actions, streak, date.ymd)) onClose()
                }}
              >
                {state === 'done' ? 'Remove completion' : 'Mark complete'}
              </Button>
            )}
            {day && (
              <Button
                variant="secondary"
                leftSection={<StreakIcon name="book" size={16} />}
                onClick={() => {
                  onClose()
                  onNavigate(streakFileHref(day.relativePath))
                }}
              >
                Open day record
              </Button>
            )}
            {!day && date.ymd === report.today && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose()
                  onNavigate('/')
                }}
              >
                Open Today
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function NewStreak({
  opened,
  report,
  actions,
  onClose,
  onCreated,
}: {
  opened: boolean
  report: StreakReport
  actions: StreaksActions
  onClose: () => void
  onCreated: (name: string) => void
}) {
  const [title, setTitle] = useState('')
  const [rule, setRule] = useState('')
  const [why, setWhy] = useState('')
  const [schedule, setSchedule] = useState('daily')
  const [start, setStart] = useState(report.today)
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')
  const duplicate = report.streaks.some((streak) => streak.title.trim().toLowerCase() === title.trim().toLowerCase())
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New streak"
      size="md"
      closeOnClickOutside={!actions.busy}
      closeOnEscape={!actions.busy}
    >
      <form
        className="sky-streaks-modal sky-streaks-new-form"
        onSubmit={async (event) => {
          event.preventDefault()
          setError('')
          try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)))
              throw new Error('Use YYYY-MM-DD for dates.')
            new PlainDate(start)
            if (end) new PlainDate(end)
            if (end && end < start) throw new Error('End must be on or after the start date.')
            if (duplicate || !title.trim() || !rule.trim()) return
            const result = await actions.act('/create', {
              title: title.trim(),
              rule: rule.trim(),
              why: why.trim(),
              schedule,
              start,
              ...(end ? { end } : {}),
            })
            if (result?.name) {
              setTitle('')
              setRule('')
              setWhy('')
              setSchedule('daily')
              setStart(report.today)
              setEnd('')
              onCreated(result.name)
            }
          } catch (problem) {
            setError((problem as Error).message)
          }
        }}
      >
        <p className="sky-streaks-form-intro">Choose a small action you want to keep coming back to.</p>
        <TextInput
          label="What’s the habit?"
          placeholder="e.g. Read a chapter"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          required
          error={duplicate ? 'A streak already uses this name. Choose a different name.' : null}
          data-autofocus
        />
        <Textarea
          label="What counts as done?"
          placeholder="Make it clear enough to answer yes or no."
          value={rule}
          onChange={(event) => setRule(event.currentTarget.value)}
          required
          minRows={2}
        />
        <Textarea
          label="Why does it matter to you?"
          placeholder="A reason to return to on a harder day."
          value={why}
          onChange={(event) => setWhy(event.currentTarget.value)}
          minRows={2}
        />
        <Select
          label="Schedule"
          data={[
            { value: 'daily', label: 'Every day' },
            { value: 'weekdays', label: 'Weekdays' },
          ]}
          value={schedule}
          onChange={(value) => setSchedule(value ?? 'daily')}
          allowDeselect={false}
        />
        <div className="sky-streaks-form-dates">
          <TextInput
            label="Start"
            placeholder="YYYY-MM-DD"
            value={start}
            onChange={(event) => setStart(event.currentTarget.value)}
            required
          />
          <TextInput
            label="End (optional)"
            placeholder="YYYY-MM-DD"
            value={end}
            onChange={(event) => setEnd(event.currentTarget.value)}
            error={end && end < start ? 'End must be on or after the start date.' : null}
          />
        </div>
        {(error || actions.error) && (
          <p className="sky-streaks-form-error" role="alert">
            {error || actions.error}
          </p>
        )}
        <div className="sky-dialog-actions">
          <Button onClick={onClose} disabled={actions.busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={actions.busy}
            disabled={duplicate || !title.trim() || !rule.trim() || !!(end && end < start)}
          >
            Create streak
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function StreakDetail({
  streak,
  report,
  actions,
  period,
  scope,
  onPeriod,
  onDay,
  onNavigate,
  onArchived,
}: {
  streak: StreakView
  report: StreakReport
  actions: StreaksActions
  period: StreakPeriod
  scope: StreakScope
  onPeriod: (month: string, scope: StreakScope) => void
  onDay: (target: StreakDayTarget) => void
  onNavigate: Navigate
  onArchived: () => void
}) {
  const summary = streakPeriodSummary(streak, period.days, report.today)
  const ended = streak.status === 'archived' || !!(streak.end && streak.end < report.today)
  const tracked = streakTracked(streak, new PlainDate(report.today))
  const done = streak.done.includes(report.today)
  const day = report.days.find((value) => value.date === report.today)
  const guidance = ended
    ? streak.end
      ? `Ended ${streak.end}`
      : 'Archived'
    : !streak.start
      ? 'Add a start date in the document'
      : streak.start > report.today
        ? `Starts ${streak.start}`
        : !tracked
          ? 'Not scheduled today'
          : done
            ? 'Including today'
            : streak.current
              ? `Complete today to reach ${streak.current + 1}`
              : 'A new run starts with today'
  return (
    <>
      <div className="sky-streaks-page-heading">
        <div>
          <div className="sky-streaks-eyebrow">
            {streak.status === 'archived'
              ? 'Archived streak'
              : streak.schedule === 'daily'
                ? 'Daily streak'
                : 'Weekday streak'}
          </div>
          <h1>{streak.title}</h1>
          {streak.rule && (
            <StreakNarrative markdown={streak.rule} html={streak.ruleHtml} className="sky-streaks-summary" />
          )}
        </div>
        <div className="sky-streaks-heading-actions">
          {streak.status === 'active' && tracked && (
            <Button
              variant={done ? 'secondary' : 'primary'}
              leftSection={<StreakIcon name="check" size={18} />}
              loading={actions.busy}
              disabled={!dayWritable(report, report.today) || ambiguousStreak(report, streak)}
              onClick={() => void completion(actions, streak, report.today)}
            >
              {done ? 'Done today' : 'Mark done today'}
            </Button>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon aria-label="Streak options">
                <StreakIcon name="more" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<StreakIcon name="book" size={16} />}
                onClick={() => onNavigate(streakFileHref(streak.relativePath))}
              >
                View streak document
              </Menu.Item>
              {streak.status === 'active' && (
                <Menu.Item
                  disabled={actions.busy}
                  onClick={async () => {
                    if (await actions.act(`/${encodeURIComponent(streak.name)}/archive`, { revision: streak.revision }))
                      onArchived()
                  }}
                >
                  Archive streak
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {streak.status === 'active' && tracked && !dayWritable(report, report.today) && (
        <p className="sky-streaks-history-note">
          {day?.ended ? (
            'Today has ended. Its record is read-only.'
          ) : (
            <>
              Start your day in{' '}
              <StreakLink href="/" onNavigate={onNavigate}>
                Today
              </StreakLink>{' '}
              to check in.
            </>
          )}
        </p>
      )}
      <div className="sky-streaks-detail-stats">
        <div>
          <span>{ended ? 'Final streak' : 'Current streak'}</span>
          <strong>
            {streak.current}
            <small> {streak.current === 1 ? 'day' : 'days'}</small>
          </strong>
          <p>{guidance}</p>
        </div>
        <div>
          <span>Personal best</span>
          <strong>
            {streak.best}
            <small> days</small>
          </strong>
          <p>
            {streak.start ? (
              <>
                Since <time>{streak.start}</time>
              </>
            ) : (
              'No start date'
            )}
          </p>
        </div>
        <div>
          <span>{period.label}</span>
          <strong>
            {summary.percent === null ? '—' : summary.percent}
            {summary.percent !== null && <small>%</small>}
          </strong>
          <p>
            {summary.total
              ? `${summary.done} of ${summary.total} scheduled days`
              : streakEmptyPeriod(streak, period.days, report.today)}
          </p>
        </div>
      </div>
      <div className={`sky-streaks-detail-columns${scope !== 'month' ? ' sky-streaks-period-wide' : ''}`}>
        <section className="sky-streaks-calendar-panel">
          <div className="sky-streaks-section-head">
            <h2>History</h2>
          </div>
          <StreakPeriodControls period={period} scope={scope} today={report.today} onChange={onPeriod} />
          {scope === 'month' ? (
            <StreakDetailedCalendar streak={streak} month={period.first} today={report.today} onDay={onDay} />
          ) : (
            <StreakCompactCalendars
              streak={streak}
              period={period}
              scope={scope}
              today={report.today}
              onMonth={(month) => onPeriod(month, 'month')}
            />
          )}
          <StreakLegend compact={scope !== 'month'} />
          <p className="sky-streaks-history-note">
            {scope === 'month'
              ? 'Select a day to see its record. Completions can be corrected while its day is open.'
              : 'Select a month to see its days and records.'}
          </p>
        </section>
        <aside className="sky-streaks-habit-context">
          {streak.why && (
            <section>
              <h2>Why this matters</h2>
              <StreakNarrative markdown={streak.why} html={streak.whyHtml} />
            </section>
          )}
          {streak.rule && (
            <section>
              <h2>What counts</h2>
              <StreakNarrative markdown={streak.rule} html={streak.ruleHtml} />
            </section>
          )}
          {!streak.why && !streak.rule && streak.bodyHtml && (
            <section>
              <RenderedHtml className="sky-doc sky-streaks-document" html={streak.bodyHtml} />
            </section>
          )}
          {streak.bodyHtml && (streak.why || streak.rule) && (
            <details className="sky-streaks-definition">
              <summary>Full streak definition</summary>
              <RenderedHtml className="sky-doc sky-streaks-document" html={streak.bodyHtml} />
            </details>
          )}
          <section className="sky-streaks-schedule">
            <h2>Schedule</h2>
            <p>{streak.schedule === 'daily' ? 'Every day' : 'Monday through Friday'}</p>
            <dl>
              <div>
                <dt>Started</dt>
                <dd>{streak.start ?? 'Not set'}</dd>
              </div>
              {streak.end && (
                <div>
                  <dt>{ended ? 'Ended' : 'Ends'}</dt>
                  <dd>{streak.end}</dd>
                </div>
              )}
            </dl>
          </section>
          <StreakLink
            className="sky-streaks-text-link sky-streaks-document-link"
            href={streakFileHref(streak.relativePath)}
            onNavigate={onNavigate}
          >
            <StreakIcon name="book" size={17} />
            View streak document
            <StreakIcon name="arrow" size={16} />
          </StreakLink>
        </aside>
      </div>
    </>
  )
}

export function StreaksMain({ path, search, onNavigate }: { path: string; search: string; onNavigate: Navigate }) {
  const data = useStreaksReport()
  const actions = useStreaksActions(data.refresh)
  const params = useMemo(() => new URLSearchParams(search), [search])
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [target, setTarget] = useState<StreakDayTarget | null>(null)
  let name = path.replace(/^\/streaks\/?/, '')
  try {
    name = decodeURIComponent(name)
  } catch {
    /* An invalid escaped name is shown as a missing streak. */
  }
  const report = data.report
  const selected = report?.streaks.find((streak) => streak.name === name)
  const tab = params.get('tab') === 'history' ? 'history' : 'overview'
  const status = params.get('status') === 'archived' ? 'archived' : 'active'
  const scope: StreakScope =
    params.get('scope') === 'year' ? 'year' : params.get('scope') === 'quarter' ? 'quarter' : 'month'
  const month = streakMonth(
    params.get('month'),
    selected?.end && report && selected.end < report.today ? selected.end : (report?.today ?? PlainDate.today().ymd),
  )
  const period = useMemo(() => streakPeriod(month, scope), [month, scope])
  const visible = report?.streaks.filter((streak) => streak.status === status) ?? []
  const habit = visible.some((streak) => streak.name === params.get('habit')) ? params.get('habit')! : ''
  const origin = new URLSearchParams(name ? (params.get('from') ?? '') : search)
  origin.delete('new')
  origin.delete('from')
  const backHref = `/streaks${origin.size ? `?${origin}` : ''}`
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(search)
    next.delete('new')
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    onNavigate(`${path}${next.size ? `?${next}` : ''}`)
  }
  const detailHref = (streak: StreakView, drillMonth?: string) => {
    const next = new URLSearchParams()
    if (tab === 'history' || drillMonth) {
      next.set('scope', drillMonth ? 'month' : scope)
      next.set('month', drillMonth ?? month)
    }
    next.set('from', origin.toString())
    return `${streakHref(streak)}?${next}`
  }
  const onDay = (day: StreakDayTarget) => {
    actions.setError('')
    setTarget(day)
  }
  useEffect(() => {
    setTarget(null)
    actions.setError('')
  }, [path])
  useEffect(() => {
    if (params.get('new') === '1') setCreating(true)
  }, [params])
  const closeCreate = () => {
    setCreating(false)
    if (params.has('new')) update({ new: '' })
  }
  const todayDate = report ? new PlainDate(report.today) : null
  const due = report?.streaks.filter((streak) => streak.status === 'active' && streakTracked(streak, todayDate!)) ?? []
  const complete = due.filter((streak) => streak.done.includes(report!.today)).length
  const day = report?.days.find((value) => value.date === report.today)
  return (
    <main className="sky-streaks-scroll">
      <div className="sky-streaks">
        <nav className="sky-streaks-breadcrumbs" aria-label="Breadcrumb">
          <StreakLink href="/" onNavigate={onNavigate}>
            Today
          </StreakLink>
          <StreakIcon name="right" size={13} />
          {name ? (
            <StreakLink href={backHref} onNavigate={onNavigate}>
              Streaks
            </StreakLink>
          ) : (
            <span>Streaks</span>
          )}
          {name && (
            <>
              <StreakIcon name="right" size={13} />
              <span>{selected?.title ?? 'Streak'}</span>
            </>
          )}
        </nav>
        <StreaksFeedback actions={actions} error={data.error} onRetry={() => void data.refresh()} />
        {report?.warnings.map((warning, index) => (
          <p key={index} className="sky-streaks-warning" role="status">
            {warning}
          </p>
        ))}
        {!report ? (
          <p className="sky-streaks-empty">{data.error ? 'Streaks could not be loaded.' : 'Loading streaks…'}</p>
        ) : name ? (
          selected ? (
            <StreakDetail
              streak={selected}
              report={report}
              actions={actions}
              period={period}
              scope={scope}
              onPeriod={(value, nextScope) => update({ month: value, scope: nextScope })}
              onDay={onDay}
              onNavigate={onNavigate}
              onArchived={() => onNavigate('/streaks')}
            />
          ) : (
            <div className="sky-streaks-empty">
              <h1>Streak not found</h1>
              <p>The streak may have been moved or removed.</p>
              <StreakLink href="/streaks" onNavigate={onNavigate} className="sky-streaks-text-link">
                View all streaks
                <StreakIcon name="arrow" size={17} />
              </StreakLink>
            </div>
          )
        ) : (
          <>
            <div className="sky-streaks-page-heading">
              <div>
                <h1>Streaks</h1>
                <p>Small commitments. A longer view.</p>
              </div>
              <Button
                variant="primary"
                leftSection={<StreakIcon name="plus" size={18} />}
                onClick={() => {
                  actions.setError('')
                  setCreating(true)
                }}
              >
                New streak
              </Button>
            </div>
            <div className="sky-streaks-view-tabs">
              <div role="group" aria-label="Streak views">
                {(['overview', 'history'] as const).map((value) => (
                  <button key={value} aria-pressed={tab === value} onClick={() => update({ tab: value })}>
                    {value === 'overview' ? 'Overview' : 'History'}
                  </button>
                ))}
              </div>
              <Menu position="bottom-end">
                <Menu.Target>
                  <button
                    className="sky-streaks-filter-button"
                    aria-label={`${status === 'active' ? 'Active' : 'Archived'} streaks`}
                  >
                    {status === 'active' ? 'Active' : 'Archived'} <span>{visible.length}</span>
                    <span aria-hidden="true">⌄</span>
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => update({ status: 'active', habit: '' })}>Active streaks</Menu.Item>
                  <Menu.Item onClick={() => update({ status: 'archived', habit: '' })}>Archived streaks</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
            {visible.length === 0 ? (
              <div className="sky-streaks-empty">
                <h2>{status === 'archived' ? 'No archived streaks yet' : 'Start with one small habit'}</h2>
                <p>
                  {status === 'archived'
                    ? 'When a habit has run its course, archive it to keep its history here.'
                    : 'Choose a repeatable action, decide what counts, and check in from Today.'}
                </p>
                {status === 'active' && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      actions.setError('')
                      setCreating(true)
                    }}
                  >
                    Create your first streak
                  </Button>
                )}
              </div>
            ) : tab === 'overview' ? (
              <>
                <div className="sky-streaks-overview-intro">
                  <div>
                    <h2>
                      {status === 'archived' ? 'Previous chapters' : 'Today'}
                      {status === 'active' && <span className="sky-streaks-today-date">{report.today}</span>}
                    </h2>
                    <p>
                      {status === 'archived'
                        ? 'Finished habits keep their history.'
                        : due.length === 0
                          ? 'No streaks are scheduled today.'
                          : `${complete} of ${due.length} done. ${complete === due.length ? 'You’re all set for today.' : day?.ended ? 'Today has ended.' : 'There’s still time for the rest.'}`}
                    </p>
                  </div>
                  {status === 'active' && (
                    <div className="sky-streaks-progress-dashes" aria-label={`${complete} of ${due.length} done`}>
                      {due.map((streak, index) => (
                        <span key={streak.relativePath} data-on={index < complete} />
                      ))}
                    </div>
                  )}
                </div>
                <HabitRows
                  streaks={visible}
                  report={report}
                  actions={actions}
                  onNavigate={onNavigate}
                  href={detailHref}
                  onDay={onDay}
                />
                {status === 'active' && (
                  <div className="sky-streaks-overview-footer">
                    <div>
                      <span className="sky-streaks-status-circle" />
                      <p>
                        {!day ? (
                          <>
                            Start your day in{' '}
                            <StreakLink href="/" onNavigate={onNavigate}>
                              Today
                            </StreakLink>{' '}
                            to check in.
                          </>
                        ) : day.ended ? (
                          'Today has ended. Its record is read-only.'
                        ) : (
                          <>
                            An unfinished today doesn’t reset your streak.
                            <br />
                            <span>Weekends don’t break a weekday streak.</span>
                          </>
                        )}
                      </p>
                    </div>
                    <button className="sky-streaks-text-link" onClick={() => update({ tab: 'history' })}>
                      See the full history
                      <StreakIcon name="arrow" size={17} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <StreakHistory
                streaks={visible}
                today={report.today}
                period={period}
                scope={scope}
                habit={habit}
                onHabit={(value) => update({ habit: value })}
                onPeriod={(value, nextScope) => update({ month: value, scope: nextScope })}
                onDay={onDay}
                href={detailHref}
                onNavigate={onNavigate}
                onMonth={(streak, value) => onNavigate(detailHref(streak, value))}
              />
            )}
          </>
        )}
        {report && (
          <>
            <NewStreak
              opened={creating}
              report={report}
              actions={actions}
              onClose={closeCreate}
              onCreated={(created) => {
                setCreating(false)
                onNavigate(`/streaks/${encodeURIComponent(created)}`)
              }}
            />
            <StreakDayDialog
              target={target}
              report={report}
              actions={actions}
              onClose={() => setTarget(null)}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>
    </main>
  )
}

export function DayStreaks({
  ymd,
  onNavigate,
  refreshKey,
  ended = false,
}: {
  ymd: string
  onNavigate: Navigate
  refreshKey?: unknown
  ended?: boolean
}) {
  const data = useStreaksReport(refreshKey ?? ymd)
  const actions = useStreaksActions(data.refresh)
  const report = data.report
  const date = new PlainDate(ymd)
  const streaks =
    report?.streaks.filter(
      (streak) => streakTracked(streak, date) && (ymd < report.today || streak.status === 'active'),
    ) ?? []
  const complete = streaks.filter((streak) => streak.done.includes(ymd)).length
  return (
    <section className="sky-streaks-day">
      <div className="sky-streaks-section-head">
        <h2>
          Streaks{' '}
          {report && (
            <span className="sky-streaks-quiet-count">
              {complete} of {streaks.length} done
            </span>
          )}
        </h2>
        <StreakLink className="sky-streaks-text-link" href="/streaks" onNavigate={onNavigate}>
          View all streaks
          <StreakIcon name="arrow" size={17} />
        </StreakLink>
      </div>
      <StreaksFeedback actions={actions} error={data.error} onRetry={() => void data.refresh()} />
      {report ? (
        streaks.length ? (
          <HabitRows
            compact
            streaks={streaks}
            report={report}
            actions={actions}
            date={ymd}
            ended={ended}
            onNavigate={onNavigate}
            href={(streak) => `${streakHref(streak)}${ymd === report.today ? '' : `?month=${ymd.slice(0, 7)}`}`}
            onDay={() => {}}
          />
        ) : (
          <p className="sky-streaks-day-empty">
            {report.streaks.length ? (
              'No streaks scheduled for this day.'
            ) : (
              <>
                Build a habit, one day at a time.{' '}
                <StreakLink href="/streaks?new=1" onNavigate={onNavigate}>
                  Create your first streak
                </StreakLink>
                .
              </>
            )}
          </p>
        )
      ) : (
        !data.error && <p className="sky-streaks-day-empty">Loading streaks…</p>
      )}
    </section>
  )
}
