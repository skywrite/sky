import { generateText } from 'ai'
/**
 * Free-text tracking entries → record column values.
 *
 * The scalar fast path (isBareScalar) never touches a model: a bare "180"
 * against weight's single value column writes directly, keeping the daily
 * one-number metrics latency-free. Everything richer goes through one fast
 * model call that maps the sentence onto the definition's declared columns
 * ("3 mile run in the park at 6:30 am" → miles, time, notes).
 */
import { z } from 'zod'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import type { TrackingColumn, TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'

const PROMPT_FILE = new URL('../prompts/parse-entry.prompt.md', import.meta.url).pathname

const NUMERIC = /^-?\d+(\.\d+)?$/

const responseSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number()])),
})

/** The columns a human answers — everything except auto-stamped time and notes. */
export function valueColumns(def: TrackingDocument): TrackingColumn[] {
  return def.columns.filter((c) => c.type !== 'time' && c.name !== 'notes')
}

/**
 * Whether the input is a bare value for a single-value definition — the
 * no-AI fast path. One value column, no spaces in the input, and numeric
 * when the column expects a number.
 */
export function isBareScalar(def: TrackingDocument, text: string): boolean {
  const columns = valueColumns(def)
  if (columns.length !== 1) return false
  if (text.includes(' ')) return false
  const type = columns[0].type
  if ((type === 'number' || type === 'duration') && !NUMERIC.test(text)) return false
  return true
}

/**
 * Keep only declared columns, stringify numbers, trim, drop empties.
 * Exported for tests — this is the guard between model output and the file.
 */
export function sanitizeParsedValues(
  def: TrackingDocument,
  raw: Record<string, string | number>,
): Record<string, string> {
  const declared = new Set(def.columns.map((c) => c.name))
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!declared.has(key)) continue
    const str = String(value).trim()
    if (str !== '') values[key] = str
  }
  return values
}

/**
 * Map a free-text entry onto the definition's columns via one fast-model
 * call. Returns null when the model fails or nothing usable was extracted —
 * callers fall back to per-column prompts, so entry is never blocked on AI.
 */
export async function parseEntry(
  def: TrackingDocument,
  entry: string,
  now: { date: string; time: string },
): Promise<Record<string, string> | null> {
  try {
    const content = await readPromptFile(PROMPT_FILE)
    const columns = def.columns.map((c) => `- ${c.name} (${c.type}${c.unit ? `, unit: ${c.unit}` : ''})`).join('\n')

    const { output } = renderPromptFile(content, 'parse-entry.prompt.md', {
      track: {
        date: now.date,
        time: now.time,
        title: def.title,
        name: def.name,
        question: def.question ?? '',
        columns,
        entry,
      },
    })

    const result = await generateText({
      ...aiModel('fast'),
      prompt: output,
    })

    const parsed = responseSchema.parse(extractJson(result.text))
    const values = sanitizeParsedValues(def, parsed.values)
    return Object.keys(values).length > 0 ? values : null
  } catch (err) {
    await logAIError({
      source: 'track:ask',
      stage: 'parse-entry',
      message: `Failed to parse "${entry}" for ${def.name}: ${(err as Error).message}`,
    })
    return null
  }
}
