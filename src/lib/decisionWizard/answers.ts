import type { Band, Effect, Feel } from './plan.ts'

/**
 * What the person chose in the wizard. Plan items are named by their place in
 * the plan; anything the person typed in is kept as their own words.
 */
export interface DecidingAnswers {
  frame?: number
  care?: 'full' | 'fast'
  wants?: number[]
  /** The want that comes first when two pull apart */
  top?: number
  /** The options being weighed */
  options?: number[]
  /** How much the person would like an outcome, where they changed Sky's read: `<option>.<outcome>` */
  feels?: Record<string, Feel>
  /** The person's odds for each option's first outcome, given before they saw Sky's */
  odds?: Record<number, Band>
  /** After seeing Sky's far-off read: keep theirs, take Sky's, or meet in the middle */
  oddsUse?: Record<number, 'mine' | 'sky' | 'middle'>
  /** What the person told Sky it was missing */
  oddsNote?: Record<number, string>
  /** An option's effect on a want, where the person changed Sky's read: `<want>.<option>` */
  effects?: Record<string, Effect>
  /**
   * Whether to check what the choice rests on before deciding. `checked` is set when the decision was
   * saved as open to do that: the person is back to decide, and the wizard does not know how the checks came out.
   */
  hinge?: 'check' | 'now' | 'checked'
  /** When "check first": the day to decide by, and which checks become to-dos */
  by?: string
  todos?: number[]
  call?: number
  /** After Sky's answer: keep the call, switch to Sky's, or go back and look at the options again */
  final?: 'keep' | 'switch' | 'again'
  /** Per option: the worries ticked, the rules adopted, and the expectation chosen, each in words */
  wrong?: Record<number, string[]>
  rules?: Record<number, string[]>
  expect?: Record<number, string>
  /** Per option: worries, rules and expectations the person typed in, so they stay listed */
  ownWrong?: Record<number, string[]>
  ownRules?: Record<number, string[]>
  ownExpect?: Record<number, string[]>
  sure?: Band
  /** The days Sky asks how it went */
  look?: string[]
  /** It keeps binding what the person does after it is carried out */
  force?: boolean
  category?: 'Personal' | 'Professional'
}

/** A decision already made: the answers are the person's own facts, so they are kept in words. */
export interface DecidedAnswers {
  wording?: string
  /** The day it was made, YYYY-MM-DD */
  when?: string
  /** What counted as known that day */
  knew?: string[]
  wants?: string[]
  /** What else was on the table */
  others?: string[]
  force?: 'until' | 'noEnd' | 'once'
  /** What ends it */
  until?: string
  expect?: string
  sure?: Band
  look?: string[]
  category?: 'Personal' | 'Professional'
  /** What the person typed in at each step, so it stays listed beside Sky's */
  own?: { wordings?: string[]; wants?: string[]; others?: string[]; expect?: string[] }
}

export type WizardAnswers = DecidingAnswers | DecidedAnswers
