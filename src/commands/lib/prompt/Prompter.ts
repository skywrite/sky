import type { PlaceWhen } from '#universal/dates/whenLabel/mod.ts'

export type { PlaceWhen }

/**
 * The questions a command may put to the person running it, and the seam
 * a host answers them through.
 *
 * `context.output` is the one-way channel out of a command; this is the way
 * back in. A command asks through it and never knows who answers: the
 * terminal (clack), a browser (a form on a page), or nobody — a headless
 * run answers nothing, and `interactive` says so up front, so a command
 * that would otherwise wait for a keystroke can take its defaults instead.
 *
 * Every answer may be null: the person cancelled, or there is no person.
 * A command treats null as "leave it as it is".
 */

export interface PromptOption {
  value: string
  label: string
  hint?: string
}

export interface TextPrompt {
  message: string
  placeholder?: string
  /** Lines shown above the question — examples, what a blank answer means */
  hint?: string[]
  initial?: string
}

export interface ConfirmPrompt {
  message: string
  initial?: boolean
}

export interface SelectPrompt {
  message: string
  options: PromptOption[]
  initial?: string
}

export interface MultiselectPrompt {
  message: string
  options: PromptOption[]
  /** Values ticked before the person touches anything */
  initial?: string[]
}

/**
 * One thing to accept and place. The item arrives with a proposed `when` —
 * what the words said, or the prompt's fallback when they said nothing —
 * and the answer says where it actually goes.
 */
export interface PlaceItem {
  value: string
  label: string
  /** Terminal hint beside the label — "me · → Tomorrow" */
  hint?: string
  /** Whether the item is the notebook owner's own */
  mine: boolean
  when: PlaceWhen
}

/**
 * Accept some items and say when each one happens: a day, a day with a
 * clock time, or no day — the Next list. A host that can only tick (the
 * terminal) answers with each ticked item's proposed `when`; a host with
 * room for it lets the person move each one.
 */
export interface PlacePrompt {
  message: string
  items: PlaceItem[]
  /** Values ticked before the person touches anything */
  initial: string[]
  /** The notebook's today, YYYY-MM-DD, so a host can say Today and Tomorrow and name the week's days */
  today: string
  /** The last day from today whose day file exists; a later day waits in the schedule until its week is made */
  createdThrough: string | null
  /** The when an item takes when nothing says otherwise */
  fallback: PlaceWhen
  /** How many items already wait on the Next list */
  waiting: number
}

export type PlaceAnswer = { value: string; when: PlaceWhen }[]

/**
 * One item of a review: a problem in some text, the sentences around it,
 * what to replace it with. The answer is one of the offered replacements,
 * something typed, or leaving it alone.
 */
export interface FormItem {
  id: string
  /** What kind of problem this is, in plain words — "Name spelling" */
  label: string
  /** The problem text as it stands */
  problem: string
  /** Sentences around the problem, enough to judge it */
  contexts: string[]
  /** How many times the problem occurs */
  occurrences: number
  /** The suggested replacement, when there is one */
  suggestion?: string
  /** Other replacements worth offering */
  alternatives: string[]
}

export interface FormPrompt {
  title: string
  /** One line under the title saying what the review is for */
  intro?: string
  items: FormItem[]
}

export type FormAnswer = { action: 'accept'; value: string } | { action: 'custom'; value: string } | { action: 'skip' }

/** Answers by item id. An item left out was never reached — the person quit early. */
export type FormAnswers = Record<string, FormAnswer>

/** A question as a host carries it: which kind, and the question itself. */
export type PromptRequest =
  | { kind: 'text'; prompt: TextPrompt }
  | { kind: 'confirm'; prompt: ConfirmPrompt }
  | { kind: 'select'; prompt: SelectPrompt }
  | { kind: 'multiselect'; prompt: MultiselectPrompt }
  | { kind: 'place'; prompt: PlacePrompt }
  | { kind: 'form'; prompt: FormPrompt }

export interface Prompter {
  /** Whether anyone is there to answer. False means every method answers null. */
  readonly interactive: boolean
  text(prompt: TextPrompt): Promise<string | null>
  confirm(prompt: ConfirmPrompt): Promise<boolean | null>
  select(prompt: SelectPrompt): Promise<string | null>
  multiselect(prompt: MultiselectPrompt): Promise<string[] | null>
  place(prompt: PlacePrompt): Promise<PlaceAnswer | null>
  form(prompt: FormPrompt): Promise<FormAnswers | null>
}
