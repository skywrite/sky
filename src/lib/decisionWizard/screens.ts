import type { DecidedAnswers, DecidingAnswers } from './answers.ts'
import type { Band, DecidedPlan, DecidingPlan } from './plan.ts'

/**
 * The order of the wizard's steps, worked out from the plan and the answers so
 * far. One question per screen. A screen that has nothing to ask is left out,
 * so the path is never longer than the decision needs.
 */

export interface Screen {
  /** `out:<n>` is "what could happen" for option n */
  id: string
  /** Its place in the path's stages, for the progress line */
  stage: number
}

export const STAGES = {
  full: [
    'The decision',
    'What you want',
    'Options',
    'What could happen',
    'Your call',
    'If it goes wrong',
    'The record',
  ],
  fast: ['The decision', 'Your call', 'The record'],
  decided: ['The decision', 'What you knew', 'What you wanted', 'The record'],
} as const
export type Path = keyof typeof STAGES

export const pathOf = (plan: DecidingPlan | DecidedPlan, answers: DecidingAnswers | DecidedAnswers): Path =>
  plan.kind === 'decided' ? 'decided' : (answers as DecidingAnswers).care === 'fast' ? 'fast' : 'full'

/** The options still on the table, in the plan's order. */
export const chosenOptions = (plan: DecidingPlan, answers: DecidingAnswers): number[] =>
  plan.options
    .map((_, option) => option)
    .filter((option) => (answers.options ?? plan.options.map((_, n) => n)).includes(option))

/** The wants that matter here, the one that comes first at the top. */
export function orderedWants(plan: DecidingPlan, answers: DecidingAnswers): number[] {
  const picked = plan.wants.map((_, want) => want).filter((want) => (answers.wants ?? []).includes(want))
  const top = answers.top !== undefined && picked.includes(answers.top) ? answers.top : picked[0]
  return top === undefined ? picked : [top, ...picked.filter((want) => want !== top)]
}

/** Sky's first choice among the options still on the table. */
export function skyPick(plan: DecidingPlan, answers: DecidingAnswers): number {
  const chosen = chosenOptions(plan, answers)
  return plan.rank.find((option) => chosen.includes(option)) ?? chosen[0] ?? 0
}

/** The odds that stand for an option: the person's, Sky's, or the middle, as they settled it. */
export function finalOdds(plan: DecidingPlan, answers: DecidingAnswers, option: number): Band | undefined {
  const mine = answers.odds?.[option]
  if (mine === undefined) return undefined
  const sky = plan.options[option]!.odds
  const use = answers.oddsUse?.[option]
  return use === 'sky' ? sky : use === 'middle' ? (Math.round((mine + sky) / 2) as Band) : mine
}

/** The person's odds and Sky's are two or more ranges apart, which is worth a question. */
export const oddsFarApart = (plan: DecidingPlan, answers: DecidingAnswers, option: number): boolean =>
  answers.odds?.[option] !== undefined && Math.abs(answers.odds[option]! - plan.options[option]!.odds) >= 2

/** The option the record is written for: the call, or Sky's when the person switched to it. */
export const finalCall = (plan: DecidingPlan, answers: DecidingAnswers): number | undefined =>
  answers.call === undefined ? undefined : answers.final === 'switch' ? skyPick(plan, answers) : answers.call

export function decidingScreens(plan: DecidingPlan, answers: DecidingAnswers): Screen[] {
  if (answers.care === 'fast')
    return [
      { id: 'frame', stage: 0 },
      { id: 'care', stage: 0 },
      { id: 'call', stage: 1 },
      { id: 'answer', stage: 1 },
      { id: 'expect', stage: 2 },
      { id: 'sure', stage: 2 },
      { id: 'record', stage: 2 },
    ]
  const chosen = chosenOptions(plan, answers)
  const hinges = chosen.some((option) => plan.options[option]!.hinges.length > 0)
  const screens: Screen[] = [
    { id: 'frame', stage: 0 },
    { id: 'care', stage: 0 },
    { id: 'wants', stage: 1 },
    // With one want there is nothing to put first.
    ...((answers.wants ?? []).length > 1 ? [{ id: 'top', stage: 1 }] : []),
    { id: 'options', stage: 2 },
    ...chosen.map((option) => ({ id: `out:${option}`, stage: 3 })),
    ...(hinges ? [{ id: 'hinge', stage: 4 }] : []),
  ]
  if (hinges && answers.hinge === 'check') return [...screens, { id: 'open', stage: 4 }]
  return [
    ...screens,
    { id: 'call', stage: 4 },
    { id: 'answer', stage: 4 },
    { id: 'wrong', stage: 5 },
    { id: 'rules', stage: 5 },
    { id: 'expect', stage: 6 },
    { id: 'sure', stage: 6 },
    { id: 'record', stage: 6 },
  ]
}

export function decidedScreens(plan: DecidedPlan): Screen[] {
  return [
    { id: 'wording', stage: 0 },
    { id: 'when', stage: 0 },
    // A decision the notebook holds no trace of has nothing to split by date.
    ...(plan.knew.length + plan.since.length > 0 ? [{ id: 'knew', stage: 1 }] : []),
    { id: 'wants', stage: 2 },
    { id: 'others', stage: 2 },
    { id: 'force', stage: 3 },
    { id: 'expect', stage: 3 },
    { id: 'sure', stage: 3 },
    { id: 'record', stage: 3 },
  ]
}

/** Whether a screen has what it needs for the person to move on. */
export function decidingReady(screen: string, plan: DecidingPlan, answers: DecidingAnswers): boolean {
  const call = finalCall(plan, answers)
  if (screen.startsWith('out:')) {
    const option = Number(screen.slice(4))
    return (
      answers.odds?.[option] !== undefined &&
      (!oddsFarApart(plan, answers, option) || answers.oddsUse?.[option] !== undefined)
    )
  }
  switch (screen) {
    case 'frame':
      return answers.frame !== undefined
    case 'care':
      return answers.care !== undefined
    case 'wants':
      return (answers.wants ?? []).length > 0
    case 'top':
      return answers.top !== undefined && (answers.wants ?? []).includes(answers.top)
    case 'options':
      return chosenOptions(plan, answers).length >= 2
    case 'hinge':
      return answers.hinge !== undefined
    case 'open':
      return Boolean(answers.by)
    case 'call':
      return answers.call !== undefined && chosenOptions(plan, answers).includes(answers.call)
    case 'answer':
      return answers.final !== undefined
    case 'expect':
      return call !== undefined && Boolean(answers.expect?.[call])
    case 'sure':
      return answers.sure !== undefined && (answers.look ?? []).length > 0
    default:
      return true
  }
}

export function decidedReady(screen: string, answers: DecidedAnswers): boolean {
  switch (screen) {
    case 'wording':
      return Boolean(answers.wording)
    case 'when':
      return Boolean(answers.when)
    case 'wants':
      return (answers.wants ?? []).length > 0
    case 'force':
      return answers.force !== undefined && (answers.force !== 'until' || Boolean(answers.until))
    case 'expect':
      return Boolean(answers.expect)
    case 'sure':
      return answers.sure !== undefined && (answers.look ?? []).length > 0
    default:
      return true
  }
}
