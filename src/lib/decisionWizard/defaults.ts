import type { DecidedAnswers, DecidingAnswers } from './answers.ts'
import type { DecidedPlan, DecidingPlan } from './plan.ts'
import { chosenOptions, finalCall, finalOdds } from './screens.ts'

/**
 * What a step starts with when the person reaches it for the first time: Sky's
 * suggestions already ticked, so agreeing is one click. A step where the
 * person's own read has to come first (their odds, their call) starts empty.
 */
export function decidingDefaults(screen: string, plan: DecidingPlan, answers: DecidingAnswers): DecidingAnswers {
  const next = { ...answers }
  const call = finalCall(plan, answers)
  if (screen === 'care') next.care ??= plan.care.suggest
  if (screen === 'wants') next.wants ??= [...plan.wantsSuggested]
  if (screen === 'options') next.options ??= plan.options.map((_, at) => at)
  if (screen === 'open')
    // Every check that can be done starts as a to-do; the person unticks what they will not do.
    next.todos ??= chosenOptions(plan, answers)
      .flatMap((option) => plan.options[option]!.hinges)
      .flatMap((hinge, at) => (hinge.todo ? [at] : []))
  if (screen === 'rules' && call !== undefined && !next.rules?.[call])
    next.rules = { ...next.rules, [call]: [...plan.options[call]!.rules] }
  if (screen === 'sure' && call !== undefined && next.sure === undefined) {
    // It starts from the odds they gave for this option, so writing the expectation down can move it.
    const odds = finalOdds(plan, answers, call)
    if (odds !== undefined) next.sure = odds
  }
  if (screen === 'record') {
    next.force ??= false
    next.category ??= plan.category
  }
  return next
}

export function decidedDefaults(screen: string, plan: DecidedPlan, answers: DecidedAnswers): DecidedAnswers {
  const next = { ...answers }
  if (screen === 'knew') next.knew ??= plan.knew.map((item) => item.text)
  if (screen === 'wants') next.wants ??= plan.wants.map((want) => want.title)
  if (screen === 'others') next.others ??= []
  if (screen === 'record') next.category ??= plan.category
  return next
}
