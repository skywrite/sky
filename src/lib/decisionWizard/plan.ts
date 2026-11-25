/**
 * What Sky prepares for the decision wizard: one plan, thought through once,
 * that every step of the wizard then reads without another model call.
 *
 * The shapes follow Annie Duke's method (How to Decide, Thinking in Bets). For
 * each option: what could happen, how much the person would like it, and how
 * likely it is. The person gives their own odds before they see Sky's, and
 * makes the call before Sky says what it would choose.
 *
 * This module holds types only, so the web client can import it.
 */

/** Odds are one of five ranges: one click to answer, and nobody pretends to two decimals. */
export const BANDS = ['Under 20%', '20–40%', '40–60%', '60–80%', 'Over 80%'] as const
export type Band = 0 | 1 | 2 | 3 | 4
export type Feel = 'like' | 'mixed' | 'dislike'
export type Effect = 'helps' | 'costs' | 'none'
export type Undo = 'Easy' | 'Costly' | 'Very hard'
export type Category = 'Personal' | 'Professional'

/** A decision the notebook suggests the person is facing, or made without writing down */
export interface Find {
  /** The decision in a few words */
  title: string
  /** Where Sky saw it, with the day */
  why: string
  /** It reads as already made */
  decided: boolean
}

/** Something the choice of an option rests on that has not been checked */
export interface PlanHinge {
  belief: string
  /** How sure the person can be today */
  sure: string
  /** What it takes to check */
  cost: string
  /** The check as a to-do, when there is one to do */
  todo: string | null
}

export interface PlanOption {
  title: string
  /** Two or three words, for a column heading */
  short: string
  /** What choosing it means, in a line */
  why: string
  /** The person named this option themselves */
  mine: boolean
  undo: Undo
  /** The decision in force this option would break, by its title */
  breaks: string | null
  /** Ways it could go, the one the person wants first */
  outcomes: Array<{ text: string; feel: Feel }>
  /** Asks how likely the first outcome is */
  question: string
  /** Sky's own odds for the first outcome, held back until the person has answered */
  odds: Band
  oddsWhy: string
  /** How this usually goes for people in the same spot */
  outside: string | null
  /** The effect on each want, in the order of the plan's wants */
  effects: Effect[]
  /** One short line on why, for each effect; empty where Sky gave none. Absent on a plan made before these. */
  effectsWhy?: string[]
  /** What this option has going for it */
  for: string
  /** The strongest case against it */
  against: string
  /** Why it failed, looking back: the reasons in the person's hands, and the ones that are not */
  wrongMine: string[]
  wrongLuck: string[]
  /** "If this by then, I will…": set while nothing is on fire */
  rules: string[]
  /** What the person would expect to see, with a date */
  expect: string[]
  /** Days worth looking back on, YYYY-MM-DD */
  look: string[]
  hinges: PlanHinge[]
}

export interface PlanWant {
  title: string
  /** Where it comes from: a goal, a decision in force, a note */
  why: string
  /** The notebook reference behind it (`goals/<name>`, `decisions/<name>`), when there is one */
  ref: string | null
  /** It comes from a decision in force */
  inForce: boolean
}

export interface DecidingPlan {
  kind: 'deciding'
  category: Category
  /** The situation in two or three sentences, for the top of the file */
  context: string
  /** Narrower and wider wordings of the same decision; the options hold under any of them */
  frames: Array<{ title: string; why: string }>
  /** The wording Sky would start from */
  frame: number
  care: {
    /** Whether it still matters in a year, and why */
    year: string
    /** How hard it is to undo */
    undo: string
    suggest: 'full' | 'fast'
  }
  wants: PlanWant[]
  /** The wants Sky is most sure apply */
  wantsSuggested: number[]
  options: PlanOption[]
  /** Two options that come out close, when two do */
  close: [number, number] | null
  /** Sky's own order, best first: held back until the person has chosen */
  rank: number[]
}

export interface Sourced {
  text: string
  /** The note it comes from, with its day */
  source: string
}

export interface DecidedPlan {
  kind: 'decided'
  category: Category
  context: string
  wordings: Array<{ title: string; why: string }>
  /** The wording Sky would use */
  wording: number
  /** Days the notebook points to, most likely first */
  when: Array<{ date: string; why: string }>
  /** What the notebook shows the person knew by that day */
  knew: Sourced[]
  /** What came to light afterwards, kept out of the reasons */
  since: Sourced[]
  wants: Array<{ title: string; why: string; ref: string | null }>
  /** Options that were on the table and not taken */
  others: Array<{ title: string; why: string }>
  force: {
    suggest: 'until' | 'noEnd' | 'once'
    /** What ends it, when something does */
    until: string | null
    why: string
  }
  /** What the person expected on the day */
  expect: Array<{ text: string; why: string }>
  /** A line of their own from the notebook about what they expected */
  quote: Sourced | null
  /** Days worth looking back on, YYYY-MM-DD */
  look: string[]
}

export type WizardPlan = DecidingPlan | DecidedPlan
