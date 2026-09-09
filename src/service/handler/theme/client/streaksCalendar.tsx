import { ActionIcon, Select, Tooltip } from '@mantine/core'
import { Fragment, type CSSProperties } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { StreakView } from '../../streaks/types.ts'
import {
  shiftStreakMonth,
  streakDayLabels,
  streakDayState,
  streakEmptyPeriod,
  streakMonthDays,
  streakPeriod,
  streakPeriodSummary,
  type StreakDayState,
  type StreakPeriod,
  type StreakScope,
} from './streaksDates.ts'
import { StreakIcon, StreakLink } from './streaksShared.tsx'

export type StreakDayTarget = { name: string; date: string }
type CalendarProps = { streak: StreakView; today: string; onDay: (target: StreakDayTarget) => void }
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function MarkContent({ state, size = 12 }: { state: StreakDayState; size?: number }) {
  return state === 'done' ? (
    <StreakIcon name="check" size={size} />
  ) : state === 'off' ? (
    '–'
  ) : state === 'missed' ? (
    '·'
  ) : null
}

export function StreakMarks({ streak, today, onDay }: CalendarProps) {
  const last = new PlainDate(today)
  return (
    <div className="sky-streaks-marks" aria-label={`Recent history for ${streak.title}`}>
      {Array.from({ length: 14 }, (_, index) => last.addDays(index - 13)).map((date) => {
        const state = streakDayState(streak, date, today)
        return (
          <Tooltip key={date.ymd} label={`${date.ymd} · ${streakDayLabels[state]}`} withArrow>
            <button
              className="sky-streaks-mark"
              data-state={state}
              data-today={date.ymd === today}
              aria-label={`${streak.title}, ${date.ymd}, ${streakDayLabels[state]}`}
              onClick={() => onDay({ name: streak.name, date: date.ymd })}
            >
              <MarkContent state={state} size={11} />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function StreakPeriodControls({
  period,
  scope,
  today,
  onChange,
}: {
  period: StreakPeriod
  scope: StreakScope
  today: string
  onChange: (month: string, scope: StreakScope) => void
}) {
  return (
    <div className="sky-streaks-period-controls">
      <div className="sky-streaks-period-toggle" role="group" aria-label="History range">
        {(['month', 'quarter', 'year'] as const).map((value) => (
          <button key={value} aria-pressed={scope === value} onClick={() => onChange(period.anchor, value)}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="sky-streaks-period-navigation">
        <div className="sky-streaks-month-nav">
          <ActionIcon
            aria-label={`Previous ${scope}`}
            disabled={period.first <= '0100-01'}
            onClick={() => onChange(shiftStreakMonth(period.first, -period.size), scope)}
          >
            <StreakIcon name="left" size={17} />
          </ActionIcon>
          <strong aria-live="polite">{period.label}</strong>
          <ActionIcon
            aria-label={`Next ${scope}`}
            disabled={period.last >= '9999-12'}
            onClick={() => onChange(shiftStreakMonth(period.first, period.size), scope)}
          >
            <StreakIcon name="right" size={17} />
          </ActionIcon>
        </div>
        {!period.months.includes(today.slice(0, 7)) && (
          <button
            className="sky-streaks-text-link sky-streaks-back-current"
            onClick={() => onChange(today.slice(0, 7), scope)}
          >
            This {scope}
          </button>
        )}
      </div>
    </div>
  )
}

export function StreakLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`sky-streaks-legend${compact ? ' sky-streaks-compact-legend' : ''}`}>
      {(['done', 'missed', 'pending', 'off', 'future'] as const).map((state) => (
        <span key={state}>
          <i className="sky-streaks-mark" data-state={state}>
            {!compact && <MarkContent state={state} size={10} />}
          </i>
          {streakDayLabels[state]}
        </span>
      ))}
    </div>
  )
}

function MiniMonth({
  streak,
  month,
  today,
  onOpen,
}: {
  streak: StreakView
  month: string
  today: string
  onOpen: () => void
}) {
  const days = streakMonthDays(month)
  const summary = streakPeriodSummary(streak, days, today)
  const name = streakPeriod(month, 'month').label
  const offset = days[0].dayOfWeek - 1
  const caption = summary.total
    ? `${summary.done} of ${summary.total} days`
    : streak.start && days[days.length - 1].ymd < streak.start
      ? 'Not started'
      : streak.end && days[0].ymd > streak.end
        ? 'Ended'
        : days[0].ymd > today
          ? 'Upcoming'
          : 'No scheduled days elapsed'
  return (
    <button
      className="sky-streaks-mini-month"
      data-month={month}
      aria-label={`Open ${name} for ${streak.title}. ${caption}.`}
      onClick={onOpen}
    >
      <span className="sky-streaks-mini-month-heading">
        <strong>{name.split(' ')[0]}</strong>
        <StreakIcon name="right" size={13} />
      </span>
      <span className="sky-streaks-mini-weekdays" aria-hidden="true">
        {weekdays.map((day) => (
          <span key={day}>{day[0]}</span>
        ))}
      </span>
      <span className="sky-streaks-mini-days" aria-hidden="true">
        {Array.from({ length: offset }, (_, index) => (
          <span key={`pad${index}`} />
        ))}
        {days.map((date) => (
          <span
            key={date.ymd}
            className="sky-streaks-mini-day"
            data-state={streakDayState(streak, date, today)}
            data-today={date.ymd === today}
            title={`${date.ymd} · ${streakDayLabels[streakDayState(streak, date, today)]}`}
          />
        ))}
        {Array.from({ length: 42 - days.length - offset }, (_, index) => (
          <span key={`tail${index}`} />
        ))}
      </span>
      <span className="sky-streaks-mini-month-caption">{caption}</span>
    </button>
  )
}

export function StreakCompactCalendars({
  streak,
  period,
  scope,
  today,
  onMonth,
}: {
  streak: StreakView
  period: StreakPeriod
  scope: StreakScope
  today: string
  onMonth: (month: string) => void
}) {
  return (
    <div
      className="sky-streaks-compact-calendars"
      data-scope={scope}
      aria-label={`${period.label} for ${streak.title}`}
    >
      {period.months.map((month) => (
        <Fragment key={month}>
          <MiniMonth streak={streak} month={month} today={today} onOpen={() => onMonth(month)} />
        </Fragment>
      ))}
    </div>
  )
}

export function StreakDetailedCalendar({ streak, month, today, onDay }: CalendarProps & { month: string }) {
  const days = streakMonthDays(month)
  return (
    <>
      <div className="sky-streaks-calendar-weekdays">
        {weekdays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="sky-streaks-calendar-grid">
        {Array.from({ length: days[0].dayOfWeek - 1 }, (_, index) => (
          <span key={`blank${index}`} />
        ))}
        {days.map((date) => {
          const state = streakDayState(streak, date, today)
          return (
            <button
              key={date.ymd}
              className="sky-streaks-calendar-day"
              data-state={state}
              data-today={date.ymd === today}
              aria-label={`${date.ymd}, ${streakDayLabels[state]}`}
              onClick={() => onDay({ name: streak.name, date: date.ymd })}
            >
              <span>{date.day}</span>
              {state === 'done' ? (
                <StreakIcon name="check" size={15} />
              ) : state === 'off' ? (
                <i>–</i>
              ) : date.ymd === today ? (
                <small>Today</small>
              ) : state === 'missed' ? (
                <i>·</i>
              ) : null}
            </button>
          )
        })}
      </div>
    </>
  )
}

export function StreakHistory({
  streaks,
  today,
  period,
  scope,
  habit,
  onHabit,
  onPeriod,
  onDay,
  href,
  onNavigate,
  onMonth,
}: {
  streaks: StreakView[]
  today: string
  period: StreakPeriod
  scope: StreakScope
  habit: string
  onHabit: (name: string) => void
  onPeriod: (month: string, scope: StreakScope) => void
  onDay: (target: StreakDayTarget) => void
  href: (streak: StreakView) => string
  onNavigate: (path: string) => void
  onMonth: (streak: StreakView, month: string) => void
}) {
  const displayed = habit ? streaks.filter((streak) => streak.name === habit) : streaks
  const days = period.days
  return (
    <section className="sky-streaks-history-section">
      <div className="sky-streaks-section-head">
        <div>
          <h2>A little history, every day</h2>
          <p>{scope === 'month' ? 'See the rhythm behind each streak.' : 'Select a month to look closer.'}</p>
        </div>
        <Select
          className="sky-streaks-history-habit-select"
          aria-label="Show habit"
          value={habit ? `habit:${habit}` : 'all'}
          onChange={(value) => onHabit(value?.startsWith('habit:') ? value.slice(6) : '')}
          data={[
            { value: 'all', label: 'All streaks' },
            ...Array.from(
              new Map(
                streaks.map((streak) => [streak.name, { value: `habit:${streak.name}`, label: streak.title }]),
              ).values(),
            ),
          ]}
          allowDeselect={false}
        />
      </div>
      <StreakPeriodControls period={period} scope={scope} today={today} onChange={onPeriod} />
      {displayed.length === 0 ? (
        <p className="sky-streaks-empty">No streaks to show in this view.</p>
      ) : scope === 'month' ? (
        <div
          className="sky-streaks-history-scroll"
          tabIndex={0}
          role="region"
          aria-label="Monthly streak history; scroll to see all days"
        >
          <div className="sky-streaks-history-grid" style={{ '--days': days.length } as CSSProperties}>
            <div className="sky-streaks-history-dates">
              <span>Habit</span>
              {days.map((date) => (
                <span key={date.ymd} data-today={date.ymd === today}>
                  <small>{weekdays[date.dayOfWeek - 1][0]}</small>
                  {date.day}
                </span>
              ))}
            </div>
            {displayed.map((streak) => (
              <div className="sky-streaks-history-row" key={streak.relativePath}>
                <StreakLink className="sky-streaks-history-title" href={href(streak)} onNavigate={onNavigate}>
                  {streak.title}
                </StreakLink>
                {days.map((date) => {
                  const state = streakDayState(streak, date, today)
                  return (
                    <Tooltip key={date.ymd} label={`${date.ymd} · ${streakDayLabels[state]}`} withArrow>
                      <button
                        className="sky-streaks-history-cell"
                        data-state={state}
                        data-today={date.ymd === today}
                        aria-label={`${streak.title}, ${date.ymd}, ${streakDayLabels[state]}`}
                        onClick={() => onDay({ name: streak.name, date: date.ymd })}
                      >
                        <MarkContent state={state} />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sky-streaks-period-habits">
          {displayed.map((streak) => {
            const summary = streakPeriodSummary(streak, period.days, today)
            return (
              <section key={streak.relativePath} className="sky-streaks-period-habit">
                <div className="sky-streaks-period-habit-heading">
                  <StreakLink href={href(streak)} onNavigate={onNavigate}>
                    {streak.title}
                    <StreakIcon name="right" size={16} />
                  </StreakLink>
                  <span>
                    {summary.total ? (
                      <>
                        <strong>
                          {summary.done} / {summary.total}
                        </strong>{' '}
                        days · {summary.percent}%
                      </>
                    ) : (
                      streakEmptyPeriod(streak, period.days, today)
                    )}
                  </span>
                </div>
                <div className="sky-streaks-period-habit-meta">
                  {streak.schedule === 'daily' ? 'Every day' : 'Weekdays'}
                  <span>·</span>
                  {streak.status === 'archived' ? 'Final' : 'Current'} {streak.current} days<span>·</span>Best{' '}
                  {streak.best} days
                </div>
                <StreakCompactCalendars
                  streak={streak}
                  period={period}
                  scope={scope}
                  today={today}
                  onMonth={(month) => onMonth(streak, month)}
                />
              </section>
            )
          })}
        </div>
      )}
      <StreakLegend compact={scope !== 'month'} />
      <p className="sky-streaks-history-note">
        An unfinished today is still open. Weekends don’t break weekday streaks.
      </p>
    </section>
  )
}
