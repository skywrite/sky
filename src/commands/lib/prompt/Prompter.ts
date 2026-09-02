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
  | { kind: 'form'; prompt: FormPrompt }

export interface Prompter {
  /** Whether anyone is there to answer. False means every method answers null. */
  readonly interactive: boolean
  text(prompt: TextPrompt): Promise<string | null>
  confirm(prompt: ConfirmPrompt): Promise<boolean | null>
  select(prompt: SelectPrompt): Promise<string | null>
  multiselect(prompt: MultiselectPrompt): Promise<string[] | null>
  form(prompt: FormPrompt): Promise<FormAnswers | null>
}
