import { generateText } from 'ai'
/**
 * Free-text tracking entries → entry date and record column values.
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
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const PROMPT_FILE = new URL('../prompts/parse-entry.prompt.md', import.meta.url).pathname

const NUMERIC = /^-?\d+(\.\d+)?$/

const responseSchema = z.object({
  // null explicitly means no date was stated. Missing or invalid dates must
  // be clarified, including responses from an older customized prompt.
  date: z.string().nullable().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
})

export interface ParsedEntry {
  /** Resolved entry date; null requires a date prompt before writing. */
  date: PlainDate | null
  values: Record<string, string>
}

/** Accept only a complete, valid calendar date, without partial-date expansion. */
export function parseEntryDate(value: string | undefined): PlainDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null
  try {
    return new PlainDate(value.trim())
  } catch {
    return null
  }
}

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

/** Keep the date outside the column filter and default only an explicitly unstated date. */
export function parseEntryResponse(def: TrackingDocument, raw: unknown, today: PlainDate): ParsedEntry | null {
  const parsed = responseSchema.parse(raw)
  const values = sanitizeParsedValues(def, parsed.values)
  if (Object.keys(values).length === 0) return null
  return { date: parsed.date === null ? today : parseEntryDate(parsed.date), values }
}

/**
 * Map a free-text entry onto its date and the definition's columns via one fast-model
 * call. Returns null when the model fails or nothing usable was extracted —
 * callers fall back to per-column prompts, so entry is never blocked on AI.
 */
export async function parseEntry(
  def: TrackingDocument,
  entry: string,
  now: { date: string; time: string },
): Promise<ParsedEntry | null> {
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

    return parseEntryResponse(def, extractJson(result.text), new PlainDate(now.date))
  } catch (err) {
    await logAIError({
      source: 'track:ask',
      stage: 'parse-entry',
      message: `Failed to parse "${entry}" for ${def.name}: ${(err as Error).message}`,
    })
    return null
  }
}
