import { choice, noul } from '@typesafe-ai/sdk'
import { type ActionRow, type ActionTable, describeRow } from './table.ts'

// The questions Jev answers about a page, all in one request: which
// operation, which target for each operation that takes one, and three
// yes/no judgments the loop gates on. jev-ultrafast's shape: the operation
// and its target answered together, every target question asked
// speculatively so no second round trip is needed.

export type Operation =
  | 'click'
  | 'type'
  | 'select'
  | 'scroll_down'
  | 'scroll_up'
  | 'wait'
  | 'back'
  | 'ask_person'
  | 'done'
  | 'blocked'

export const OPERATION_INSTRUCTIONS =
  'Advance `goal` from the CURRENT page with one operation. `plan`, when present, is the next thing to achieve on this page toward the goal; follow it. Use `controls` (what is on screen now), `page_text` and `history` (what was already done, newest last). Never repeat a step that `history` shows already happened. Fill the fields a form needs before submitting it. Choose `done` only when `page_text`, `controls` or `history` show visible evidence that every requirement of `goal` is satisfied. Choose `ask_person` when the page needs the person: signing in, a password, a verification code, a passkey, an account choice, a captcha, or a step that would move money or commit them. A page that already shows the person signed in — their name, their accounts or balances, a Log out or Sign out control — does not need them; work on it. If `history` says the person is done on this page, do not ask again unless the page has changed. Choose `blocked` only when no listed operation can make progress.'

const OPERATIONS: Record<Operation, string> = {
  click: 'Click one of the controls: a link, a button, a checkbox, a tab.',
  type: 'Type text into one of the text fields.',
  select: 'Choose an option in one of the dropdowns.',
  scroll_down: 'What is needed is likely below the viewport; scroll down to see more controls.',
  scroll_up: 'What is needed is likely above the viewport; scroll up.',
  wait: 'The page is still loading or changing; give it a moment. Use sparingly.',
  back: 'This page is a wrong turn; go back to the previous page.',
  ask_person:
    'The person must act first: sign in, enter a password or a code, pass a verification or captcha, choose an account, or approve a step that moves money or commits them.',
  done: 'Every requirement of the goal is visibly satisfied. Nothing more to do.',
  blocked: 'No operation on this page can make progress toward the goal.',
}

export const TARGET_INSTRUCTIONS =
  'If the next operation is the one this question is about, which control is the best target? Use each row’s label, value and `near` text, and `goal` and `history`. Do not choose a field that already holds the requested value.'

export const NEEDS_PERSON =
  'The page requires the person to act before the goal can progress: sign in, enter a password or a verification code, use a passkey, pass a captcha, or choose between accounts. A page that already shows the person signed in — their name, accounts, balances, a Log out or Sign out control — does not require them, even if it also offers a sign-in link.'
export const DONE =
  'Given `history`, `page_text` and `controls`, every requirement of `goal` has already been achieved.'
export const RISKY =
  'The most likely next action on this page would move money, buy or sell, sign or agree to something, send a message, or otherwise commit the person to something beyond reading, navigating, or downloading.'

/** Which operations are on offer for this page. */
export function operationCriteria(table: ActionTable, history: string[]): Partial<Record<Operation, string>> {
  const offered: Partial<Record<Operation, string>> = {}
  const kinds = new Set(table.rows.map((row) => row.kind))
  if (kinds.has('click')) offered.click = OPERATIONS.click
  if (kinds.has('type')) offered.type = OPERATIONS.type
  if (kinds.has('select')) offered.select = OPERATIONS.select
  if (table.below > 0) offered.scroll_down = OPERATIONS.scroll_down
  if (table.above > 0) offered.scroll_up = OPERATIONS.scroll_up
  offered.wait = OPERATIONS.wait
  if (history.length > 0) offered.back = OPERATIONS.back
  offered.ask_person = OPERATIONS.ask_person
  offered.done = OPERATIONS.done
  offered.blocked = OPERATIONS.blocked
  return offered
}

/** The rows an operation may target, keyed `t<index>`, plus `none`. */
export function targetCriteria(rows: ActionRow[], kind: ActionRow['kind']): Record<string, string> {
  const criteria: Record<string, string> = {}
  for (const row of rows) if (row.kind === kind) criteria[`t${row.index}`] = describeRow(row)
  criteria.none = 'No control fits this operation.'
  return criteria
}

export const TARGET_QUESTION: Record<'click' | 'type' | 'select', 'click_target' | 'type_target' | 'select_target'> = {
  click: 'click_target',
  type: 'type_target',
  select: 'select_target',
}

/** A dropdown's options, keyed by the option text, for the select operation. */
export function optionCriteria(row: ActionRow): Record<string, string> {
  const criteria: Record<string, string> = {}
  for (const option of row.options ?? [])
    criteria[option] = option === row.value ? `${option} (currently chosen)` : option
  return criteria
}

/** How many dropdowns get their own option question in one request. */
export const MAX_SELECT_QUESTIONS = 5

/** Every question for this page, in one request. */
export function jevQuestions(table: ActionTable, history: string[]) {
  const operations = operationCriteria(table, history)
  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
    operation: choice(OPERATION_INSTRUCTIONS, operations),
    needs_person: noul(NEEDS_PERSON),
    done: noul(DONE),
    risky: noul(RISKY),
  }
  for (const kind of ['click', 'type', 'select'] as const) {
    if (!(kind in operations)) continue
    questions[TARGET_QUESTION[kind]] = choice(
      `${TARGET_INSTRUCTIONS} This question is about: ${kind}.`,
      targetCriteria(table.rows, kind),
    )
  }
  let selects = 0
  for (const row of table.rows) {
    if (row.kind !== 'select' || !row.options?.length || selects >= MAX_SELECT_QUESTIONS) continue
    selects++
    questions[`option_t${row.index}`] = choice(
      `If the next operation is select on control [${row.index}] ${row.name ? `"${row.name}"` : ''}, which option serves \`goal\`?`,
      optionCriteria(row),
    )
  }
  return questions
}
