import { Button, Checkbox } from '@mantine/core'
import { useState } from 'react'
import { Block } from '../day/day.tsx'
import { fileHref } from '../explorer/explorer.tsx'
import { useWeekSummary } from './useWeekSummary.ts'
import './WeekSummary.css'

export function WeekSummary({ week, onReview }: { week: string; onReview: (day: string) => void }) {
  const { view, error, submitting, generate, refresh } = useWeekSummary(week)
  const [allowMissing, setAllowMissing] = useState(false)
  const busy = submitting || view?.running
  const partial = Boolean(view?.missing.length)

  return (
    <section aria-label="Weekly summary">
      <Block
        head="Weekly summary"
        mini={view?.path ? 'Saved' : view ? `${view.availableDays} of 7 daily summaries` : undefined}
      >
        <div className="sky-week-summary">
          {error && (
            <div role="alert" className="sky-wnote">
              {error}{' '}
              <Button size="sm" onClick={refresh}>
                Refresh
              </Button>
            </div>
          )}
          {!view && !error && <p role="status">Checking the week’s summaries…</p>}
          {view?.path ? (
            <>
              <p>The week’s summary is saved and ready to read.</p>
              <div>
                <Button component="a" href={fileHref(view.path)} variant="primary">
                  Read weekly summary
                </Button>
              </div>
            </>
          ) : (
            view && (
              <>
                <p>Bring the week’s progress, decisions, and lessons together from its daily summaries.</p>
                {!view.complete ? (
                  <p>Generate this summary after the week ends. You can review each day below in the meantime.</p>
                ) : (
                  <>
                    {view.missing.length > 0 && (
                      <details className="sky-week-summary-gaps">
                        <summary>
                          {view.missing.length} {view.missing.length === 1 ? 'day needs' : 'days need'} a summary
                        </summary>
                        <ul>
                          {view.missing.map((day) => (
                            <li key={day.day}>
                              <span>
                                {day.weekday} · {day.day}
                                <small>{day.reason}</small>
                              </span>
                              {day.path ? (
                                <Button size="sm" component="a" href={fileHref(day.path)}>
                                  Open daily summary
                                </Button>
                              ) : (
                                <Button size="sm" onClick={() => onReview(day.day)}>
                                  Review {day.weekday}
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {view.availableDays === 0 && <p>Review and summarize at least one day to get started.</p>}
                    {partial && view.availableDays > 0 && (
                      <Checkbox
                        label="Generate with the available daily summaries"
                        description="The weekly summary will identify the gaps."
                        checked={allowMissing}
                        onChange={(event) => setAllowMissing(event.currentTarget.checked)}
                        disabled={busy}
                      />
                    )}
                    {view.error && (
                      <p role="alert" className="sky-wnote">
                        {view.error}
                      </p>
                    )}
                    {busy && (
                      <p role="status">
                        Generating the weekly summary… You can leave this page and return when it’s ready.
                      </p>
                    )}
                    {!view.enabled && (
                      <p>Summary generation is unavailable in this service. Refresh after reconnecting to Sky.</p>
                    )}
                    <div>
                      <Button
                        variant="primary"
                        loading={busy}
                        disabled={!view.enabled || !view.availableDays || (partial && !allowMissing)}
                        onClick={() => void generate(allowMissing)}
                      >
                        {view.error ? 'Retry weekly summary' : 'Generate weekly summary'}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )
          )}
        </div>
      </Block>
    </section>
  )
}
