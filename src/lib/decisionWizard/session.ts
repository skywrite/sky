import type { WizardAnswers } from './answers.ts'
import type { Find, WizardPlan } from './plan.ts'

/**
 * One run of the decision wizard: what the person said, the plan Sky thought
 * through, and the answers so far. It is Sky's working state, so it lives in
 * the state folder and never in the notebook. The notebook gets the decision's
 * file, when the person saves.
 */

/** What Sky read before thinking, so the page can say what it is working from */
export interface ReadCounts {
  goals: number
  inForce: number
  notes: number
}
export type ThinkStage = 'reading' | 'thinking' | 'writing'

export interface WizardSession {
  id: string
  /** The decision as the person said it, or as Sky found it */
  statement: string
  /** Where Sky found it, when it came from the notebook */
  why: string | null
  /** The person says it is already made */
  decided: boolean
  status: 'thinking' | 'ready' | 'failed'
  stage: ThinkStage | null
  /** When the thinking began, in epoch milliseconds, so the page can say how long it has been */
  since: number | null
  read: ReadCounts | null
  /** Why the thinking failed, in words the person can act on */
  error: string | null
  plan: WizardPlan | null
  answers: WizardAnswers
  /** The step the person is on */
  step: string | null
  /** An option or a want the person typed in, while Sky works it out */
  adding: {
    kind: 'option' | 'want'
    text: string
    since: number
    error: string | null
    /** Typed in at the call: once worked out it becomes the call, and the person's reason is kept beside it */
    call?: boolean
    because?: string
  } | null
  /** The open decision this wizard saved before the call was made, by name */
  open: string | null
  /**
   * The open decision's file as the wizard last wrote it. The file is rewritten only while it still reads this
   * way: null means it was changed by hand, or the run is older than this, and the wizard leaves it alone.
   */
  openText?: string | null
  /** The step the open decision's file was last written at */
  openStep?: string | null
}

/** A wizard that was started and not finished, as the Decisions list shows it */
export interface WizardSummary {
  id: string
  title: string
  status: WizardSession['status']
  decided: boolean
  open: string | null
}

export interface FindsView {
  status: 'looking' | 'ready' | 'failed'
  finds: Find[]
  error: string | null
}

/** What the page shows once a decision is saved */
export interface WizardSaved {
  name: string
  title: string
  /** Filed as still open */
  open: boolean
  inForce: boolean
  /** The day it is dated, when that is not today */
  when: string | null
  /** The days a reminder to look back was set for */
  look: string[]
  /** The to-dos added to today */
  todos: string[]
  /** Anything that was asked for and could not be done, in plain words */
  warnings: string[]
}
