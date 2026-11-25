import type { DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import { BANDS, type DecidingPlan, type Effect } from '#lib/decisionWizard/plan.ts'
import { finalCall, finalOdds, orderedWants } from '#lib/decisionWizard/screens.ts'
import { Mark } from './Mark.tsx'
import { effectOf, weighed } from './tally.ts'

const LABEL: Record<Effect, string> = { helps: 'Helps', costs: 'Costs', none: 'No effect' }

/**
 * How the options stand against what the person wants: options across, wants
 * down, and in each cell whether the option helps or costs that want, with one
 * line of why. Each option carries its tally, so the columns can be compared
 * at a glance before any cell is read.
 */
export function Weighing({
  plan,
  answers,
  made,
}: {
  plan: DecidingPlan
  answers: DecidingAnswers
  /** The call is saved: the picked option is the call, not a leaning */
  made: boolean
}) {
  const { options, wants } = weighed(plan, answers)
  const call = finalCall(plan, answers)
  const ordered = orderedWants(plan, answers).length > 1
  const picked = (option: number) => (call === option ? true : undefined)
  return (
    <div className="sky-decision-grid">
      <table>
        <thead>
          <tr>
            <td />
            {options.map((option) => {
              const item = plan.options[option]!
              const effects = wants.map((want) => effectOf(plan, answers, want, option).effect)
              const helps = effects.filter((effect) => effect === 'helps').length
              const costs = effects.filter((effect) => effect === 'costs').length
              return (
                <th key={option} scope="col" data-picked={picked(option)}>
                  {call === option && (
                    <span className="sky-decision-call">{made ? 'Your call' : 'Leaning toward'}</span>
                  )}
                  {/* The short name heads the column; the option in full sits under it. */}
                  <span className="sky-decision-option">{item.short}</span>
                  {item.title !== item.short && <span className="sky-decision-about">{item.title}</span>}
                  <span className="sky-decision-tally">
                    <span className="sky-decision-bars" aria-hidden="true">
                      {effects.map((effect, at) => (
                        // eslint-disable-next-line react/no-array-index-key -- one bar per want, in the grid's own order
                        <i key={at} data-effect={effect} />
                      ))}
                    </span>
                    {helps || costs
                      ? [helps ? `Helps ${helps}` : '', costs ? `${helps ? 'costs' : 'Costs'} ${costs}` : '']
                          .filter(Boolean)
                          .join(', ')
                      : 'No effect'}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {wants.map((want, row) => {
            const item = plan.wants[want]!
            return (
              <tr key={want}>
                <th scope="row">
                  <span className="sky-decision-want">
                    {/* A want that is one of the person's goals, or a decision in force, carries that mark. */}
                    {item.ref?.startsWith('goals/') ? (
                      <Mark kind="goal" />
                    ) : item.inForce ? (
                      <Mark kind="decision" />
                    ) : (
                      <i className="sky-future-mark" data-kind="want" aria-hidden="true" />
                    )}
                    <span>{item.title}</span>
                  </span>
                  {row === 0 && ordered && <span className="sky-decision-first">Comes first</span>}
                  <span className="sky-decision-from" title={item.why}>
                    {item.why}
                  </span>
                </th>
                {options.map((option) => {
                  const { effect, why } = effectOf(plan, answers, want, option)
                  return (
                    <td key={option} data-picked={picked(option)}>
                      <span className="sky-decision-effect" data-effect={effect}>
                        {LABEL[effect]}
                      </span>
                      {why && <span className="sky-decision-why">{why}</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          <tr data-facts="true">
            <th scope="row">
              <span className="sky-decision-fact">Odds it goes the way you want</span>
            </th>
            {options.map((option) => {
              const odds = finalOdds(plan, answers, option)
              return (
                <td key={option} data-picked={picked(option)}>
                  {/* Sky's odds appear only beside the person's own, as in the wizard. */}
                  {odds === undefined ? (
                    <span className="sky-decision-quiet">Not said yet</span>
                  ) : (
                    <>
                      <span className="sky-decision-odds">You: {BANDS[odds]}</span>
                      <span className="sky-decision-quiet">Sky: {BANDS[plan.options[option]!.odds]}</span>
                    </>
                  )}
                </td>
              )
            })}
          </tr>
          <tr data-facts="true">
            <th scope="row">
              <span className="sky-decision-fact">To undo</span>
            </th>
            {options.map((option) => (
              <td key={option} data-picked={picked(option)}>
                <span className="sky-decision-level" data-level={plan.options[option]!.undo}>
                  {plan.options[option]!.undo}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
