import { generateText } from 'ai'
import { extractJson } from '#shared/ai/extractJson.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { type ActionRow, type ActionTable, describeRow } from './table.ts'

// Jev picks fast; it cannot read a failure or plan a route. A language
// model steps in at the moments that need reading: a page seen for the
// first time, a move that failed, a page that did not change, or Jev
// asking for the person. It answers with a one-line sub-goal for Jev, a
// judgment on whether the person is needed, and, when it knows a better
// move than Jev's table offers, that move.

export type AdviceTrigger = 'new_page' | 'move_failed' | 'no_change' | 'jev_asks'

export type AdviceAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; index: number }
  | { kind: 'press'; key: string }
  | { kind: 'scroll_down' }
  | { kind: 'wait' }

export interface Advice {
  /** What to do next on this page, in one line, for Jev's state */
  subgoal: string
  /** Whether the page itself blocks progress until the person acts */
  needsPerson: boolean
  /** The adviser could not be reached or did not answer: nothing here is a judgment */
  failed?: boolean
  /** A move the adviser is sure of; otherwise Jev picks */
  action?: AdviceAction
  reason: string
}

export interface AdviseOptions {
  model: ResolvedModel
  goal: string
  table: ActionTable
  history: string[]
  trigger: AdviceTrigger
  /** The failed move's error, for move_failed */
  failure?: string
  /** Addresses this task has been to, which a navigate may return to */
  known?: string[]
  /** Test seam: the model's raw reply for a prompt */
  reply?: (system: string, prompt: string) => Promise<string>
}

export interface AdviseResult {
  advice: Advice
  usage: { input: number; output: number }
  ms: number
  /** The model's reply as written, for the trace */
  raw?: string
}

export const ADVISOR_INSTRUCTIONS = `You guide a fast browser agent that can only pick from the controls listed. You read the page and answer with JSON only, no prose:
{"subgoal": "<one line: the next thing to achieve on this page toward the goal>", "needs_person": true|false, "action": {...} | null, "reason": "<one short sentence>"}

Rules for needs_person:
- true only when the page itself blocks progress until the person acts: a password or code field to fill, a passkey prompt, a captcha, a choice between accounts, or a step that would move money or commit them.
- A page that shows the person signed in — their name, their accounts or balances, a Log out or Sign out control — is false, even if it also offers a sign-in link.

Rules for action (give one only when you are sure; otherwise null and let the agent pick):
- {"kind": "click", "index": N} for a control from the table.
- {"kind": "navigate", "url": "..."} only with an address taken from a link's href in the table, or one of been_to (the task's own addresses so far), when a click is blocked, the page is blank, or the same page keeps coming back.
- {"kind": "press", "key": "Escape"} when a dialog, banner or overlay covers the page; or click the control that dismisses it.
- {"kind": "scroll_down"} when what is needed is below the viewport.
- {"kind": "wait"} when the page is still loading.
When a move failed because something intercepts clicks, prefer dismissing the overlay or navigating to the link's own address over clicking the same control again.
Never invent an index or an address.`

const ROW_LIMIT = 200
const HISTORY_LINES = 12

function rowsForModel(rows: ActionRow[]): string[] {
  return rows.slice(0, ROW_LIMIT).map((row) => (row.href ? `${describeRow(row)} href=${row.href}` : describeRow(row)))
}

function validate(raw: unknown, table: ActionTable, known: string[] = []): Advice {
  const o = (raw ?? {}) as Record<string, unknown>
  const subgoal = typeof o.subgoal === 'string' ? o.subgoal.trim().slice(0, 300) : ''
  const advice: Advice = {
    subgoal: subgoal || 'Continue toward the goal on this page.',
    needsPerson: o.needs_person === true,
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '',
  }
  const action = o.action as Record<string, unknown> | null | undefined
  if (!action || typeof action !== 'object') return advice
  const hrefs = new Set(table.rows.map((row) => row.href).filter((href): href is string => typeof href === 'string'))
  const revisitable = new Set(known.map((url) => url.replace(/\/$/, '')))
  switch (action.kind) {
    case 'click': {
      const index = Number(action.index)
      if (Number.isInteger(index) && table.rows[index]) advice.action = { kind: 'click', index }
      break
    }
    case 'navigate': {
      const url = typeof action.url === 'string' ? action.url : ''
      const onPage = hrefs.has(url) || [...hrefs].some((href) => resolve(href, table.url) === url)
      const beenThere = revisitable.has(resolve(url, table.url).replace(/\/$/, ''))
      if (onPage || beenThere) advice.action = { kind: 'navigate', url: resolve(url, table.url) }
      break
    }
    case 'press':
      if (typeof action.key === 'string' && /^[A-Za-z0-9]+$/.test(action.key))
        advice.action = { kind: 'press', key: action.key }
      break
    case 'scroll_down':
    case 'wait':
      advice.action = { kind: action.kind }
      break
  }
  return advice
}

function resolve(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** A brief for this page, from the adviser model. Never throws: a bad reply is no advice. */
export async function advise(options: AdviseOptions): Promise<AdviseResult> {
  const { table } = options
  const prompt = JSON.stringify(
    {
      goal: options.goal,
      why_asked:
        options.trigger === 'new_page'
          ? 'A page seen for the first time.'
          : options.trigger === 'move_failed'
            ? `The last move failed: ${options.failure ?? ''}`
            : options.trigger === 'no_change'
              ? 'The last move changed nothing on the page.'
              : 'The fast agent wants to hand over to the person.',
      page: { url: table.url, title: table.title, text: table.text },
      controls: rowsForModel(table.rows),
      been_to: (options.known ?? []).slice(-8),
      off_screen: { above: table.above, below: table.below },
      history: options.history.slice(-HISTORY_LINES),
    },
    null,
    1,
  )
  const started = performance.now()
  let text = ''
  let usage = { input: 0, output: 0 }
  try {
    if (options.reply) text = await options.reply(ADVISOR_INSTRUCTIONS, prompt)
    else {
      const { contextWindow: _window, ...settings } = options.model
      // Room for a reasoning model to think before the short JSON it owes.
      const result = await generateText({ ...settings, system: ADVISOR_INSTRUCTIONS, prompt, maxOutputTokens: 1500 })
      text = result.text
      usage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 }
    }
  } catch (error) {
    return {
      advice: {
        subgoal: '',
        needsPerson: false,
        failed: true,
        reason: `The adviser failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      usage,
      ms: Math.round(performance.now() - started),
    }
  }
  let parsed: unknown
  try {
    parsed = extractJson(text)
  } catch {
    parsed = {}
  }
  return {
    advice: validate(parsed, table, options.known),
    usage,
    ms: Math.round(performance.now() - started),
    raw: text,
  }
}
