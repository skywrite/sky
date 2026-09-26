/**
 * The write-up check's correction line, read by a model into the fields it
 * changes and the renames it asks for (renames.ts). What the person typed as
 * a labelled field — time:, who:, rel: — is read in code before this and
 * wins over it; summary.ts applies both.
 *
 * On the reasoning role, as the message door's check is: what comes back
 * lands in the fields and, for a rename, in every word of the notes.
 */

import { generateText } from 'ai'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import type { Rename } from './renames.ts'

const PROMPT_FILE = new URL('../prompts/transcript-corrections.prompt.md', import.meta.url).pathname

/** The fields as the check shows them */
export interface CheckFields {
  title: string
  time: string | null
  durationMinutes: number | null
  medium: string | null
  who: string[]
  rel: string[]
  from: string | null
  to: string | null
}

/** What the line changes; a field left out is unchanged */
export interface ParsedCorrections {
  title?: string
  time?: string
  durationMinutes?: number
  medium?: string
  from?: string
  to?: string
  who?: string[]
  rel?: string[]
  renames: Rename[]
}

export interface ParseInput {
  corrections: string
  fields: CheckFields
  /** The audio-message template: from/to instead of who */
  message: boolean
  /** The write-up as the check shows it, where a rename's other spellings are found */
  writeup: string
  /** The notebook's date, YYYY-MM-DD */
  today: string
  signal?: AbortSignal
}

export async function parseCorrections(input: ParseInput): Promise<ParsedCorrections> {
  const { fields } = input
  const content = await readPromptFile(PROMPT_FILE)
  const { output: prompt } = renderPromptFile(content, 'transcript-corrections.prompt.md', {
    check: {
      title: fields.title,
      time: fields.time ?? 'null',
      duration: fields.durationMinutes === null ? 'null' : String(fields.durationMinutes),
      medium: fields.medium ?? 'null',
      people: input.message
        ? `- from: ${fields.from ?? 'null'}\n- to: ${fields.to ?? 'null'}`
        : `- who: ${JSON.stringify(fields.who)}`,
      rel: JSON.stringify(fields.rel),
      today: input.today,
      peopleRules: input.message
        ? '- from and to are single names; rel is an array of names.'
        : '- who and rel are arrays of names.',
      writeup: input.writeup,
      corrections: input.corrections,
    },
  })
  const result = await generateText({ ...aiModel('reasoning'), abortSignal: input.signal, prompt })
  let raw: unknown
  try {
    raw = extractJson(result.text)
  } catch (err) {
    throw new Error(`${(err as Error).message} — raw head: ${result.text.slice(0, 200)}`)
  }
  return readParsed(raw)
}

/**
 * The model's JSON as the check applies it. A field of the wrong shape is
 * dropped rather than failing the line, and so is a rename without both
 * sides.
 */
export function readParsed(raw: unknown): ParsedCorrections {
  const data = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const names = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map((n) => n.trim())
      : undefined
  const renames = (Array.isArray(data.renames) ? data.renames : []).flatMap((entry: unknown) => {
    const rename = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const right = text(rename.right)
    const wrong = names(rename.wrong) ?? (text(rename.wrong) ? [text(rename.wrong) as string] : [])
    return right && wrong.length > 0 ? [{ wrong, right }] : []
  })
  const duration = data.durationMinutes
  return {
    title: text(data.title),
    time: text(data.time),
    durationMinutes: typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined,
    medium: text(data.medium),
    from: text(data.from),
    to: text(data.to),
    who: names(data.who),
    rel: names(data.rel),
    renames,
  }
}
