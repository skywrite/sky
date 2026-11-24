import type { DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import { BANDS, type DecidingPlan, type Effect } from '#lib/decisionWizard/plan.ts'
import { chosenOptions, finalOdds, orderedWants } from '#lib/decisionWizard/screens.ts'

const LABEL: Record<Effect, string> = { helps: 'Helps', costs: 'Costs', none: 'No effect' }
const NEXT: Record<Effect, Effect> = { helps: 'costs', costs: 'none', none: 'helps' }

/**
 * Options across, what the person wants down: whether each option helps or
 * costs each want, the odds they gave beside Sky's, and how hard it is to undo.
 * The marks are Sky's read; a click changes one.
 */
export function CompareGrid({
  plan,
  answers,
  onEffect,
}: {
  plan: DecidingPlan
  answers: DecidingAnswers
  onEffect: (key: string, effect: Effect) => void
}) {
  const options = chosenOptions(plan, answers)
  const wants = orderedWants(plan, answers)
  const picked = (option: number) => (answers.call === option ? true : undefined)
  return (
    <div className="sky-wizard-grid">
      <table>
        <thead>
          <tr>
            <td />
            {options.map((option) => (
              <th key={option} scope="col" data-picked={picked(option)}>
                {plan.options[option]!.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wants.map((want, n) => (
            <tr key={want}>
              <th scope="row">
                {plan.wants[want]!.title}
                {n === 0 && wants.length > 1 && <span className="sky-wizard-first">Comes first</span>}
              </th>
              {options.map((option) => {
                const key = `${want}.${option}`
                const effect = answers.effects?.[key] ?? plan.options[option]!.effects[want] ?? 'none'
                return (
                  <td key={option} data-picked={picked(option)}>
                    <button
                      type="button"
                      className="sky-wizard-cell"
                      data-effect={effect}
                      aria-label={`${plan.options[option]!.short}, ${plan.wants[want]!.title}: ${LABEL[effect]}. Change`}
                      onClick={() => onEffect(key, NEXT[effect])}
                    >
                      {LABEL[effect]}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
          <tr data-sep="true">
            <th scope="row">Odds it goes the way you want</th>
            {options.map((option) => {
              const odds = finalOdds(plan, answers, option)
              return (
                <td key={option} data-picked={picked(option)}>
                  <span className="sky-wizard-odds">
                    <b>You: {odds === undefined ? '—' : BANDS[odds]}</b>
                    <small>Sky: {BANDS[plan.options[option]!.odds]}</small>
                  </span>
                </td>
              )
            })}
          </tr>
          <tr>
            <th scope="row">To undo</th>
            {options.map((option) => (
              <td key={option} data-picked={picked(option)}>
                {plan.options[option]!.undo}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
