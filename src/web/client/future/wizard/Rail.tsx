import type { ReactNode } from 'react'
import type { DecidedAnswers, DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import { BANDS, type DecidedPlan, type DecidingPlan } from '#lib/decisionWizard/plan.ts'
import { chosenOptions, finalCall, finalOdds, orderedWants } from '#lib/decisionWizard/screens.ts'
import { niceDate } from '../dates.ts'

const lines = (items: ReactNode[]): ReactNode =>
  items.map((item, at) => (
    // eslint-disable-next-line react/no-array-index-key -- the list is rebuilt whole and never reordered in place
    <span key={at} className="sky-wizard-rail-line">
      {item}
    </span>
  ))

/**
 * The record so far: what the person has chosen, written down as they go, where the day page keeps its rail.
 * It appears with the first thing chosen; an empty box beside the first question says nothing.
 */
export function Rail({
  plan,
  answers,
  today,
}: {
  plan: DecidingPlan | DecidedPlan
  answers: DecidingAnswers | DecidedAnswers
  today: string
}) {
  const rows: Array<[string, ReactNode]> = []
  const add = (label: string, value: ReactNode | false | undefined | null | '') => {
    if (value) rows.push([label, value])
  }
  if (plan.kind === 'decided') {
    const mine = answers as DecidedAnswers
    add('Decided', mine.when && niceDate(mine.when, today))
    add(
      'Rests on',
      mine.knew && mine.when && `${mine.knew.length} thing${mine.knew.length === 1 ? '' : 's'} you knew that day`,
    )
    add('Wanted', mine.wants?.length && lines(mine.wants))
    add('Chosen over', mine.others?.length && lines(mine.others))
    add(
      'In force',
      mine.force &&
        (mine.force === 'until'
          ? `Until ${(mine.until ?? '').replace(/[.]$/, '')}`
          : mine.force === 'noEnd'
            ? 'With no end'
            : 'No'),
    )
    add('Expected', mine.expect)
    add('How sure', mine.sure !== undefined && BANDS[mine.sure])
  } else {
    const mine = answers as DecidingAnswers
    const wants = orderedWants(plan, mine)
    const call = finalCall(plan, mine)
    add(
      'What you want',
      mine.wants?.length &&
        lines(
          wants.map(
            (want, n) => `${mine.top !== undefined && wants.length > 1 ? `${n + 1}. ` : ''}${plan.wants[want]!.title}`,
          ),
        ),
    )
    add(
      'Options',
      mine.options &&
        lines(
          chosenOptions(plan, mine).map((option) => {
            const odds = finalOdds(plan, mine, option)
            return (
              <>
                {plan.options[option]!.short}
                {odds !== undefined && (
                  <small>
                    {' '}
                    You {BANDS[odds]}, Sky {BANDS[plan.options[option]!.odds]}
                  </small>
                )}
              </>
            )
          }),
        ),
    )
    add('Your call', call !== undefined && mine.final && plan.options[call]!.title)
    add('Rules set ahead', call !== undefined && mine.rules?.[call]?.length && lines(mine.rules[call]!))
    add('You expect', call !== undefined && mine.expect?.[call])
    add('How sure', mine.sure !== undefined && mine.look?.length && BANDS[mine.sure])
  }
  if (!rows.length) return null
  return (
    <aside className="sky-wizard-rail" aria-label="The record so far">
      <h3>The record so far</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
