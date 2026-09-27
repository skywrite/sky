import { generateText } from 'ai'
import { extractJson } from '#shared/ai/extractJson.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import type { ActionRow, ActionTable } from './table.ts'

// Jev picks the field; it cannot write what goes in it. A language model
// does that, once per typed field, from the goal and the page — the
// jev-ultrafast split, with the person's reasoning model as the writer.
// Password and code fields never get here.

export const TEXT_INSTRUCTIONS =
  'You fill one field in a browser for a person. Return a JSON object with exactly one key, "text": the exact string to enter in the selected field, taken from the task or plainly implied by it. If the task does not say what belongs in this field and it cannot be inferred with certainty, return {"text": null}. Never invent personal data: names, numbers, addresses, credentials. No other keys, no prose.'

/** The field's text, capped like a form would cap it. */
export const MAX_TEXT_CHARS = 2000

export interface FieldTextOptions {
  model: ResolvedModel
  goal: string
  row: ActionRow
  table: ActionTable
  history: string[]
}

export interface FieldTextResult {
  text: string | null
  usage: { input: number; output: number }
}

/** The text for one field, or null when nothing in the task belongs there. */
export async function fieldText(options: FieldTextOptions): Promise<FieldTextResult> {
  const { row, table } = options
  if (row.secret) return { text: null, usage: { input: 0, output: 0 } }
  const context = {
    task: options.goal,
    field: {
      role: row.role,
      label: row.name,
      ...(row.placeholder ? { placeholder: row.placeholder } : {}),
      ...(row.value !== undefined ? { current_value: row.value } : {}),
      ...(row.near ? { text_beside_it: row.near } : {}),
    },
    page: { url: table.url, title: table.title, text: table.text },
    recent_actions: options.history.slice(-10),
  }
  const { contextWindow: _window, ...settings } = options.model
  const result = await generateText({
    ...settings,
    system: TEXT_INSTRUCTIONS,
    prompt: JSON.stringify(context, null, 1),
    maxOutputTokens: 300,
  })
  const usage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 }
  let parsed: { text?: unknown }
  try {
    parsed = extractJson<{ text?: unknown }>(result.text)
  } catch {
    return { text: null, usage }
  }
  const text = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, MAX_TEXT_CHARS) : null
  return { text: text || null, usage }
}
