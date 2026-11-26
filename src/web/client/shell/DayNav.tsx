import type { DayRef } from '../day/day.tsx'
import { type WeekData, weekHref } from '../week/week.tsx'

/**
 * Tomorrow, the past days and the two weeks: under Today in the sidebar, and in the
 * sheet a phone opens from the day's date.
 */
export function DayNav({
  tomorrowYmd,
  tomorrowActive,
  days,
  activeDayYmd,
  isWeek,
  weekId,
  thisWeek,
  navigate,
}: {
  tomorrowYmd: string | null
  tomorrowActive: boolean
  /** The days before today, newest first */
  days: DayRef[]
  activeDayYmd: string | null
  isWeek: boolean
  weekId: string | null
  thisWeek: WeekData | null
  navigate: (to: string) => void
}) {
  return (
    <div className="sky-side-dates">
      {tomorrowYmd && (
        <div className="sky-side-tomorrow">
          <button
            type="button"
            className="sky-thread"
            data-active={tomorrowActive}
            aria-current={tomorrowActive ? 'page' : undefined}
            onClick={() => navigate(`/${tomorrowYmd}`)}
          >
            <span>Tomorrow</span>
            <time className="sky-meta" dateTime={tomorrowYmd} title={tomorrowYmd}>
              {tomorrowYmd.slice(5)}
            </time>
          </button>
        </div>
      )}
      <div className="sky-side-label">Past days</div>
      {days.map((d) => (
        <button
          key={d.ymd}
          type="button"
          className="sky-thread"
          data-active={!isWeek && activeDayYmd === d.ymd}
          aria-current={!isWeek && activeDayYmd === d.ymd ? 'page' : undefined}
          onClick={() => navigate(`/${d.ymd}`)}
        >
          <span>{d.label}</span>
          <time className="sky-meta" dateTime={d.ymd} title={d.ymd}>
            {d.ymd.slice(5)}
          </time>
        </button>
      ))}

      {/* The two horizons: this week, with the day waiting to start, and the next. */}
      <div className="sky-side-label">Week</div>
      <button
        type="button"
        className="sky-thread sky-side-week"
        data-active={isWeek && (weekId === '' || weekId === thisWeek?.id)}
        aria-current={isWeek && (weekId === '' || weekId === thisWeek?.id) ? 'page' : undefined}
        onClick={() => navigate('/week')}
      >
        <span>
          This week
          {thisWeek?.due && <span className="sky-wdot" />}
        </span>
        <span className="sky-meta">
          {thisWeek?.due ? `${thisWeek.due.weekday} not started` : thisWeek ? thisWeek.id.slice(5) : ''}
        </span>
      </button>
      {thisWeek && (
        <button
          type="button"
          className="sky-thread sky-side-week"
          data-active={isWeek && weekId === thisWeek.next.id}
          aria-current={isWeek && weekId === thisWeek.next.id ? 'page' : undefined}
          onClick={() => navigate(weekHref(thisWeek.next.id))}
        >
          <span>Next week</span>
          <span className="sky-meta">{thisWeek.next.planned ? 'planned' : 'no plan yet'}</span>
        </button>
      )}
    </div>
  )
}
