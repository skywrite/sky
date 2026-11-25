import { type MouseEvent, type ReactNode, useEffect } from 'react'
import type { ResponseScore } from '#lib/needsResponse/earned.ts'
import { QUIET_HOURS } from '#lib/needsResponse/marks.ts'
import { DailyPoints } from './DailyPoints.tsx'
import { GradeSteps } from './GradeSteps.tsx'
import { MARK_NAMES } from './markNames.ts'
import { useResponseScore } from './useResponseScore.ts'
import { WaitSplit } from './WaitSplit.tsx'
import './ResponseScoreMain.css'

/** `22:00` as `10pm`. */
function hourLabel(time: string): string {
  const hour = Number(time.slice(0, 2))
  return `${((hour + 11) % 12) + 1}${hour < 12 ? 'am' : 'pm'}`
}

const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`

function Section({ head, note, children }: { head: string; note?: string; children: ReactNode }) {
  return (
    <section className="sky-rs-section">
      <div className="sky-rs-section-head">
        <h2>{head}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Score({ score }: { score: ResponseScore }) {
  const waited = score.waits.reduce((sum, n) => sum + n, 0)
  const anything = waited > 0 || score.days.some((day) => day.replies > 0)

  return (
    <>
      <div className="sky-rs-hero">
        <div className="sky-rs-hero-number">{score.today.points.toLocaleString('en-US')}</div>
        {anything ? (
          <p className="sky-rs-hero-read">
            <span>
              <b>{count(score.today.replies, 'reply', 'replies')}</b> today, {score.today.quick} inside {MARK_NAMES[0]}.
            </span>
            <span>
              <b>{score.week.points.toLocaleString('en-US')}</b> in the last 7 days.
            </span>
            <small>Points today. There is no daily maximum.</small>
          </p>
        ) : (
          <p className="sky-rs-hero-read">
            <span>
              <b>Nothing counted yet.</b>
            </span>
            <span>Reply to a message on Today, or tick it once you have answered, and its points land here.</span>
          </p>
        )}
      </div>

      {waited > 0 && (
        <Section head="How long people waited" note={`${count(waited, 'message', 'messages')} in the last 7 days`}>
          <WaitSplit waits={score.waits} />
        </Section>
      )}

      {anything && (
        <Section head="Last 30 days" note="Points earned each day">
          <DailyPoints days={score.days} />
        </Section>
      )}

      <Section head="How a message is graded">
        <GradeSteps />
        <p className="sky-rs-caption">
          A message is worth 100 when it arrives and loses 20 at each mark. Reply and you earn what it is worth. Replies
          after 30 minutes, 3 hours and 2 days earn 100, 80 and 20. That is 200 points.
        </p>
      </Section>

      <Section head="What counts">
        <ul className="sky-rs-rules">
          <li>Your score for a day is every point you earned that day. There is no maximum.</li>
          <li>
            You earn a message's points when you reply, or when you tick it as answered. Clearing it with the X earns
            nothing.
          </li>
          <li>
            The clock starts when the message that needs your reply arrives. A follow-up from the same person does not
            restart it.
          </li>
          <li>
            The clock stops overnight. Hours between {hourLabel(QUIET_HOURS.from)} and {hourLabel(QUIET_HOURS.until)}{' '}
            are left out of the 1-hour, 4-hour and 12-hour marks.
          </li>
          <li>
            A quick reply to a message that never reached the list counts too: inside 4 hours, once per conversation a
            day.
          </li>
          <li>After 3 days a message is worth nothing. After 7 days with no reply it leaves the list.</li>
        </ul>
      </Section>
    </>
  )
}

/** The response score page: today's points, how long people waited, the last 30 days, and how it is graded. */
export function ResponseScoreMain({ navigate }: { navigate: (path: string) => void }) {
  const { state, retry } = useResponseScore()

  // The page is the same screen while it loads, fails or shows a score, so the title never changes.
  useEffect(() => {
    document.title = 'sky · Response score'
  }, [])

  const toToday = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate('/')
  }

  return (
    <main className="sky-main sky-rs">
      <div className="sky-scroll">
        <div className="sky-rs-col">
          <header className="sky-rs-head">
            <h1>Response score</h1>
            <a href="/" onClick={toToday}>
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 12H5m5-5-5 5 5 5" />
              </svg>
              Today
            </a>
          </header>

          {state.status === 'loading' && (
            <p className="sky-rs-status" role="status">
              Loading your response score…
            </p>
          )}
          {state.status === 'error' && (
            <div className="sky-rs-status" role="alert">
              <p>Sky could not load your response score. Nothing is lost: your replies are still being counted.</p>
              <button type="button" onClick={retry}>
                Try again
              </button>
            </div>
          )}
          {state.status === 'ready' && <Score score={state.score} />}
        </div>
      </div>
    </main>
  )
}
