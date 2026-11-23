import { Button } from '@mantine/core'
import { type ReactNode, useState } from 'react'
import type { FutureEnding, FutureGoal } from '../../../service/handler/future/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { RenderedHtml } from '../lib/renderedHtml.tsx'
import { Checkpoints } from './Checkpoints.tsx'
import { CloseGoalDialog } from './CloseGoalDialog.tsx'
import { ClosePrompt } from './ClosePrompt.tsx'
import { DateDialog } from './DateDialog.tsx'
import { niceDate, timeLeft } from './dates.ts'
import { ENDING_LABEL } from './endings.ts'
import { FutureLink } from './FutureLink.tsx'
import { GoalChart } from './GoalChart.tsx'
import { NumberDialog } from './NumberDialog.tsx'
import { futureRequest } from './request.ts'
import { goalHref } from './routes.ts'
import { TieLink } from './TieLink.tsx'

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="sky-future-section">
      <h2>
        {title}
        {count ? <small>{count}</small> : null}
      </h2>
      {children}
    </section>
  )
}

function Row({ children, under, end }: { children: ReactNode; under?: string; end?: string | null }) {
  return (
    <div className="sky-future-row">
      <span>
        {children}
        {under && <span className="sky-future-under">{under}</span>}
      </span>
      {end && <span className="sky-future-meta">{end}</span>}
    </div>
  )
}

/** One goal: where its number stands, its checkpoints, and everything tied to it. */
export function GoalPage({
  goal,
  today,
  navigate,
  onChanged,
}: {
  goal: FutureGoal
  today: string
  navigate: (to: string) => void
  onChanged: () => Promise<void>
}) {
  const [connecting, setConnecting] = useState(false)
  const [dating, setDating] = useState(false)
  // `false` is no dialog; an ending is the one the page already knows; null leaves the choice open.
  const [closing, setClosing] = useState<FutureEnding | null | false>(false)
  const [reopening, setReopening] = useState(false)
  const [problem, setProblem] = useState('')
  const number = goal.number
  const closed = goal.status !== 'active'
  const reopen = async () => {
    setReopening(true)
    setProblem('')
    try {
      await futureRequest(`/goals/${encodeURIComponent(goal.name)}/reopen`, {})
      await onChanged()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setReopening(false)
    }
  }
  const when = (ymd: string | null) => (ymd ? niceDate(ymd, today) : null)
  return (
    <>
      <nav className="sky-future-crumbs" aria-label="Breadcrumb">
        <FutureLink to="/future" navigate={navigate}>
          Future
        </FutureLink>
        <span aria-hidden="true">›</span>
        <span>Goals</span>
      </nav>
      <header className="sky-future-head">
        <div>
          <h1>{goal.title}</h1>
          <p className="sky-future-sub">
            <span>{goal.category}</span>
            {goal.status !== 'active' && (
              <span>
                <span className="sky-future-state" data-state={goal.status}>
                  {ENDING_LABEL[goal.status]}
                </span>
                {goal.ended ? ` on ${niceDate(goal.ended, today)}` : ''}
              </span>
            )}
            {goal.due && <span>By {niceDate(goal.due, today)}</span>}
            {goal.daysLeft !== null && !number?.reached && <span>{timeLeft(goal.daysLeft)}</span>}
            {goal.serves && (
              <span>
                Serves{' '}
                <FutureLink to={goalHref(goal.serves.name)} navigate={navigate} className="sky-future-text-link">
                  {goal.serves.title}
                </FutureLink>
              </span>
            )}
          </p>
        </div>
        <div className="sky-future-head-actions">
          {closed ? (
            <Button variant="secondary" loading={reopening} onClick={() => void reopen()}>
              Reopen
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setClosing(number?.reached ? 'reached' : null)}>
              Close this goal
            </Button>
          )}
          <Button component="a" href={fileHref(goal.file)} variant="secondary">
            Open the file
          </Button>
        </div>
      </header>
      {problem && (
        <div className="sky-future-error" role="alert">
          {problem}
        </div>
      )}
      {!closed && (
        <ClosePrompt
          goal={goal}
          today={today}
          onClose={(ending) => setClosing(ending)}
          onMoveDate={() => setDating(true)}
        />
      )}

      {number ? (
        <>
          <div className="sky-future-stats">
            <div>
              <span>{closed ? 'Final' : number.latest?.date === today ? 'Today' : 'Latest'}</span>
              <strong>{number.latest?.text ?? '—'}</strong>
              <em>
                {number.latest
                  ? number.latest.date === today
                    ? `${number.trackerTitle}, recorded today`
                    : `${number.trackerTitle}, ${niceDate(number.latest.date, today)}`
                  : `Nothing recorded since ${niceDate(number.from, today)}`}
              </em>
            </div>
            {number.first && number.movedText && (
              <div>
                <span>{goal.start ? 'Since you started' : `Since ${niceDate(number.first.date, today)}`}</span>
                <strong>{number.movedText}</strong>
                <em>
                  From {number.first.text} on {niceDate(number.first.date, today)}
                </em>
              </div>
            )}
            {number.targetText && (
              <div>
                <span>{number.reached ? 'Goal' : closed ? 'Short by' : 'To go'}</span>
                <strong>{number.reached ? 'Reached' : (number.toGoText ?? '—')}</strong>
                <em>
                  {number.targetText}
                  {goal.due ? ` by ${niceDate(goal.due, today)}` : ''}
                </em>
              </div>
            )}
          </div>
          {number.points.length > 0 && (
            <div className="sky-future-chart-card">
              <div className="sky-future-legend">
                <span>
                  <i data-line="recorded" />
                  {number.trackerTitle}
                </span>
                {number.target !== null && (
                  <span>
                    <i data-line="target" />
                    The goal
                  </span>
                )}
                {!closed && number.dueDay !== null && number.target !== null && !number.reached && goal.due && (
                  <span>
                    <i data-line="needs" />
                    What {niceDate(goal.due, today)} needs
                  </span>
                )}
                {goal.checkpoints.some((checkpoint) => checkpoint.day !== null) && (
                  <span>
                    <i data-line="checkpoint" />
                    Checkpoints
                  </span>
                )}
              </div>
              <GoalChart number={number} checkpoints={goal.checkpoints} due={goal.due} today={today} closed={closed} />
            </div>
          )}
          <p className="sky-future-note">
            Counting from {niceDate(number.from, today)}
            {goal.start ? ', the day you started' : ', the day this goal was written'}.{' '}
            {!closed && (
              <button type="button" className="sky-future-text-link" onClick={() => setConnecting(true)}>
                Change the number
              </button>
            )}
          </p>
          {(!closed || goal.checkpoints.length > 0) && (
            <Section title="Checkpoints" count={goal.checkpoints.length}>
              <Checkpoints goal={goal} today={today} onChanged={onChanged} readOnly={closed} />
            </Section>
          )}
        </>
      ) : closed ? null : (
        <div className="sky-future-panel">
          <h3>{goal.numberProblem ? 'The number is missing' : 'No number connected'}</h3>
          <p>
            {goal.numberProblem ??
              'Sky can’t say where this stands until it has a number to watch. Connect one you already track.'}
          </p>
          <Button variant="primary" onClick={() => setConnecting(true)}>
            {goal.numberProblem ? 'Choose another number' : 'Connect a number'}
          </Button>
        </div>
      )}

      {goal.smaller.length > 0 && (
        <Section title="Smaller goals" count={goal.smaller.length}>
          <p className="sky-future-note">
            A different outcome that serves this one. It has its own file, with a line saying it serves this goal.
          </p>
          <div className="sky-future-rows">
            {goal.smaller.map((tie) => (
              <Row key={tie.name} end="Serves this goal">
                <TieLink kind="goal" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.inForce.length > 0 && (
        <Section title="In force" count={goal.inForce.length}>
          <div className="sky-future-rows">
            {goal.inForce.map((tie) => (
              <Row key={tie.file} end={tie.since && `Since ${when(tie.since)}`}>
                <TieLink kind="decision" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.toDecide.length > 0 && (
        <Section title="To decide" count={goal.toDecide.length}>
          <div className="sky-future-rows">
            {goal.toDecide.map((tie) => (
              <Row key={tie.file} end={tie.since && `Open since ${when(tie.since)}`}>
                <TieLink kind="decision" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.habits.length > 0 && (
        <Section title="Habits that move it" count={goal.habits.length}>
          <div className="sky-future-rows">
            {goal.habits.map((tie) => (
              <Row key={tie.name}>
                <TieLink kind="habit" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.ideas.length > 0 && (
        <Section title="Ideas" count={goal.ideas.length}>
          <div className="sky-future-rows">
            {goal.ideas.map((tie) => (
              <Row
                key={tie.file}
                end={tie.status === 'draft' ? 'Draft' : tie.status === 'exploring' ? 'Exploring' : 'Acted on'}
              >
                <TieLink kind="idea" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.decided.length > 0 && (
        <Section title="Decided" count={goal.decided.length}>
          <div className="sky-future-rows">
            {goal.decided.map((tie) => (
              <Row key={tie.file} end={tie.since && `Decided ${when(tie.since)}`}>
                <TieLink kind="decision" {...tie} navigate={navigate} />
              </Row>
            ))}
          </div>
        </Section>
      )}
      {goal.bodyHtml.trim() && (
        <Section title="In your words">
          <RenderedHtml className="sky-future-document" html={goal.bodyHtml} />
        </Section>
      )}
      {closing !== false && (
        <CloseGoalDialog
          goal={goal}
          today={today}
          preset={closing}
          onClose={() => setClosing(false)}
          onClosed={onChanged}
        />
      )}
      {dating && <DateDialog goal={goal} today={today} onClose={() => setDating(false)} onSaved={onChanged} />}
      {connecting && (
        <NumberDialog
          goal={goal}
          today={today}
          onClose={() => setConnecting(false)}
          onSaved={onChanged}
          navigate={navigate}
        />
      )}
    </>
  )
}
