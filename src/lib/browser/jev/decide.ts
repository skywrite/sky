import type { TypeSafeClient } from '@typesafe-ai/sdk'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import { jevQuestions, type Operation, TARGET_QUESTION } from './questions.ts'
import { type ActionRow, type ActionTable, describeRow } from './table.ts'

// One decision: the page as a table, the goal and the history go to Jev in
// one request; the answers come back as probabilities and are checked
// before anything runs — a choice must name an option on offer, and its
// distribution must be a distribution. jev-ultrafast's validate_choice.

export interface Decision {
  operation: Operation
  target?: ActionRow
  /** For select: the option to choose */
  option?: string
  probability: number
  confidence: number
  targetProbability?: number
  targetConfidence?: number
  needsPerson: number
  done: number
  risky: number
  model: string
  inputTokens: number
  ms: number
  /** Why the operation was changed after the answer: a target of none, a missing option */
  note?: string
  /** Every operation on offer with its probability, for the next-best move */
  operations: Record<string, number>
  /** The raw answers and the questions they answer, for a second reading */
  raw: { answers: Record<string, LooseAnswer>; questions: Record<string, { criteria?: Record<string, unknown> }> }
}

/** What one answer looks like, loosely: a choice, or a noul. */
export interface LooseAnswer {
  choice?: string
  probabilities?: Record<string, number>
  confidence?: number
  noul?: number
}

export interface LooseResult {
  model: string
  answers: Record<string, LooseAnswer>
  usage: { input_tokens: number; output_tokens: number }
}

/** The request as it goes out — a test scripts the answers instead. */
export type AskJev = (request: { state: unknown; questions: Record<string, unknown> }) => Promise<LooseResult>

export interface DecideOptions {
  goal: string
  table: ActionTable
  history: string[]
  ask: AskJev
  /** The adviser's one-line sub-goal for this page, when there is one */
  plan?: string
  now?: () => number
}

/** The history Jev sees: the newest ten lines. */
export const HISTORY_LINES = 10

export class JevAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevAnswerError'
  }
}

/** Jev over a client, as the loop calls it. */
export function askWith(client: TypeSafeClient): AskJev {
  return (request) => askTypeSafe(client, request as never) as unknown as Promise<LooseResult>
}

function validChoice(name: string, answer: LooseAnswer | undefined, criteria: Record<string, unknown>): string {
  if (!answer || typeof answer.choice !== 'string' || !answer.probabilities)
    throw new JevAnswerError(`Jev did not answer ${name}.`)
  if (!(answer.choice in criteria))
    throw new JevAnswerError(`Jev chose "${answer.choice}" for ${name}, which was not offered.`)
  const values = Object.values(answer.probabilities)
  if (values.some((p) => !Number.isFinite(p) || p < 0 || p > 1))
    throw new JevAnswerError(`Jev's probabilities for ${name} are not probabilities.`)
  const sum = values.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.02) throw new JevAnswerError(`Jev's probabilities for ${name} sum to ${sum.toFixed(2)}.`)
  const max = Math.max(...values)
  if ((answer.probabilities[answer.choice] ?? 0) < max - 1e-6)
    throw new JevAnswerError(`Jev's choice for ${name} is not its most likely option.`)
  if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence))
    throw new JevAnswerError(`Jev gave no confidence for ${name}.`)
  return answer.choice
}

const nouls = (answer: LooseAnswer | undefined): number =>
  typeof answer?.noul === 'number' && Number.isFinite(answer.noul) ? answer.noul : 0

/** Ask, check, and turn the answers into one action. */
export async function decide(options: DecideOptions): Promise<Decision> {
  const { goal, table, history, ask, now = () => performance.now() } = options
  const questions = jevQuestions(table, history) as Record<string, { criteria?: Record<string, unknown> }>
  const state = {
    goal,
    ...(options.plan ? { plan: options.plan } : {}),
    url: table.url,
    title: table.title,
    page_text: table.text,
    controls: table.rows.map(describeRow),
    ...(table.above > 0 || table.below > 0
      ? { off_screen: `${table.above} controls above the viewport, ${table.below} below` }
      : {}),
    history: history.slice(-HISTORY_LINES),
  }
  const started = now()
  const result = await ask({ state, questions })
  const ms = Math.round(now() - started)
  const answers = result.answers

  const operationCriteria = questions.operation?.criteria ?? {}
  const operation = validChoice('operation', answers.operation, operationCriteria) as Operation
  const decision: Decision = {
    operation,
    probability: answers.operation?.probabilities?.[operation] ?? 0,
    confidence: answers.operation?.confidence ?? 0,
    needsPerson: nouls(answers.needs_person),
    done: nouls(answers.done),
    risky: nouls(answers.risky),
    model: result.model,
    inputTokens: result.usage.input_tokens,
    ms,
    operations: answers.operation?.probabilities ?? {},
    raw: { answers, questions },
  }
  resolveTarget(decision, operation, table)
  return decision
}

/** Fill in the target (and option) an operation needs, from the answers already given. */
function resolveTarget(decision: Decision, operation: Operation, table: ActionTable): void {
  const { answers, questions } = decision.raw
  decision.operation = operation
  decision.target = undefined
  decision.option = undefined
  if (operation !== 'click' && operation !== 'type' && operation !== 'select') return
  const name = TARGET_QUESTION[operation]
  const criteria = questions[name]?.criteria ?? {}
  const chosen = validChoice(name, answers[name], criteria)
  if (chosen === 'none') {
    decision.operation = 'blocked'
    decision.note = `Jev chose ${operation} but no control fit it.`
    return
  }
  const row = table.rows[Number(chosen.slice(1))]
  if (!row) throw new JevAnswerError(`Jev's target ${chosen} is not a row.`)
  decision.target = row
  decision.targetProbability = answers[name]?.probabilities?.[chosen] ?? 0
  decision.targetConfidence = answers[name]?.confidence ?? 0
  if (operation === 'select') {
    const optionName = `option_t${row.index}`
    const optionCriteria = questions[optionName]?.criteria
    if (optionCriteria) decision.option = validChoice(optionName, answers[optionName], optionCriteria)
    else {
      decision.operation = 'blocked'
      decision.note = `Dropdown [${row.index}] had no option question.`
    }
  }
}

/**
 * The same decision with Jev's next-best operation in place of the ones
 * ruled out — when the person has already answered a page and Jev still
 * wants to ask, the move it rated second runs instead. Null when nothing
 * else on offer was worth more than a coin toss.
 */
export function nextBest(decision: Decision, table: ActionTable, ruledOut: Set<Operation>): Decision | null {
  const candidates = Object.entries(decision.operations)
    .filter(([operation]) => !ruledOut.has(operation as Operation))
    .sort((a, b) => b[1] - a[1])
  for (const [operation, probability] of candidates) {
    if (probability < 0.05) break
    const alternative: Decision = { ...decision, probability, note: undefined }
    try {
      resolveTarget(alternative, operation as Operation, table)
    } catch {
      continue
    }
    if (alternative.operation === 'blocked') continue
    alternative.note = `Jev asked for ${decision.operation}; the next-best move ran instead.`
    return alternative
  }
  return null
}
