/**
 * A name or term the person fixes at the write-up check — "it's not Pria,
 * it's Priya" — carried into everything the words feed, not only a field.
 *
 * The check used to change fields only: the fix landed in rel while the
 * write-up and the corrected transcript kept the wrong spelling, and the
 * names review's glossary ruling kept pointing at it. A rename now reaches:
 *
 * - the transcript, by the same literal find→replace the names step uses —
 *   never a model rewrite (applyCorrections.ts says why);
 * - the people lists, where a single name that exactly one profile answers
 *   to becomes that profile's full name, so it links. A list the person
 *   typed out at the check is theirs and is left alone (summary.ts);
 * - the glossary, when the check ends, so the next transcript gets it
 *   right — and a ruling the names review made toward the spelling now
 *   called wrong points at the right one instead;
 * - the write-up, rewritten by a model with only the rename to carry. A
 *   literal replace there would leave the notes the wrong spelling caused
 *   ("also transcribed as …") reading as nonsense.
 *
 * A rename is only ever what the person said. A changed field is never read
 * as one (prompts/transcript-corrections.prompt.md).
 */

import { streamText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { type PersonIndexEntry, profilesAnsweringTo } from '#shared/models/Person/subjects.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { applyCorrections, countOccurrences, MIN_NEEDLE_LENGTH } from './applyCorrections.ts'
import { normalizeTerm } from './dedupeIssues.ts'
import { buildRulings, type GlossaryRuling } from './glossary.ts'
import type { ReviewCorrection } from './transcriptRun.ts'

export interface Rename {
  /** Every spelling the words use for the name or term: the one the person named, and any the write-up treats as the same */
  wrong: string[]
  /** The spelling the person gave */
  right: string
}

const PROMPT_FILE = new URL('../prompts/transcript-rename.prompt.md', import.meta.url).pathname

/**
 * The renames, keeping only the spellings the words actually hold and can
 * lose safely. A spelling neither text holds is dropped. So is one inside
 * the right spelling itself: "Priya" → "Priya Raman" would double on every
 * replace. A rename left with nothing to replace is dropped.
 */
export function foundRenames(renames: Rename[], texts: string[]): Rename[] {
  const found: Rename[] = []
  for (const rename of renames) {
    const right = rename.right.trim()
    if (right === '') continue
    const seen = new Set<string>()
    const wrong = rename.wrong
      .map((spelling) => spelling.trim())
      .filter((spelling) => {
        const key = normalizeTerm(spelling)
        if (seen.has(key)) return false
        seen.add(key)
        if (spelling.length < MIN_NEEDLE_LENGTH || spelling === right) return false
        if (key !== normalizeTerm(right) && countOccurrences(right, spelling) > 0) return false
        return texts.some((text) => countOccurrences(text, spelling) > 0)
      })
    if (wrong.length > 0) found.push({ wrong, right })
  }
  return found
}

/** The text with the renames applied in order, so a later rename sees what an earlier one wrote. */
export function applyRenames(text: string, renames: Rename[]): string {
  let current = text
  for (const rename of renames) {
    const corrections = rename.wrong.map((spelling) => ({
      originalText: spelling,
      correction: rename.right,
      occurrences: 1,
    }))
    current = applyCorrections(current, corrections).text
  }
  return current
}

/**
 * The name a rename leaves in a people list. A single word that exactly one
 * profile answers to becomes that profile's full name, so the list links it.
 * A full name, or a word several profiles answer to, stays as spelled.
 */
export function profileNameFor(name: string, index: PersonIndexEntry[] | null): string {
  if (!index || normalizeName(name).split(' ').length > 1) return name
  const answering = profilesAnsweringTo(name, index)
  return answering.length === 1 ? answering[0].name : name
}

/**
 * A people list with the renames carried in. An entry holding a wrong
 * spelling takes the right one. An entry that is the right spelling, as
 * typed or as renamed, takes the profile's full name (profileNameFor).
 * Duplicates the renames create collapse to the first.
 */
export function renameNames(names: string[], renames: Rename[], index: PersonIndexEntry[] | null): string[] {
  const renamed: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    let current = name
    for (const rename of renames) {
      const next = applyRenames(current, [rename])
      if (next !== current || normalizeTerm(current) === normalizeTerm(rename.right)) {
        current = profileNameFor(next, index)
      }
    }
    const key = normalizeTerm(current)
    if (seen.has(key)) continue
    seen.add(key)
    renamed.push(current)
  }
  return renamed
}

/**
 * The renames folded into one another, in the order they were made. When a
 * later rename calls an earlier one's right spelling wrong, the earlier
 * wrong spellings point at the later right one too.
 */
export function composeRenames(renames: Rename[]): Rename[] {
  const composed: Rename[] = []
  for (const rename of renames) {
    const wrong = new Set(rename.wrong.map(normalizeTerm))
    for (let i = 0; i < composed.length; i++) {
      if (wrong.has(normalizeTerm(composed[i].right))) composed[i] = { wrong: composed[i].wrong, right: rename.right }
    }
    composed.push({ wrong: [...rename.wrong], right: rename.right })
  }
  return composed
}

/**
 * The glossary rulings a check's renames make, through the same gates as
 * the names review's (buildRulings): every wrong spelling to the right one.
 * A review answer that turned a word into a spelling now called wrong gets a
 * ruling too, from the word the transcriber actually wrote to the right one.
 * It replaces the review's own ruling for that word.
 */
export function renameRulings(renames: Rename[], review: ReviewCorrection[]): GlossaryRuling[] {
  const issues: Array<{ type: string; originalText: string }> = []
  const answers: Array<{ issueIndex: number; correction: string; action: 'custom' }> = []
  const rule = (wrong: string, right: string) => {
    answers.push({ issueIndex: issues.length, correction: right, action: 'custom' })
    issues.push({ type: 'name', originalText: wrong })
  }
  for (const rename of composeRenames(renames)) {
    const wrong = new Set(rename.wrong.map(normalizeTerm))
    for (const spelling of rename.wrong) rule(spelling, rename.right)
    for (const answer of review) {
      if (answer.action !== 'skip' && wrong.has(normalizeTerm(answer.correction)))
        rule(answer.originalText, rename.right)
    }
  }
  return buildRulings(issues, answers)
}

/** The renames as the rewrite prompt reads them, with the full name a list resolved where there is one. */
export function renamesText(renames: Rename[], index: PersonIndexEntry[] | null): string {
  return renames
    .map((rename) => {
      const wrong = rename.wrong.map((spelling) => `"${spelling}"`).join(', ')
      const full = profileNameFor(rename.right, index)
      const known = full !== rename.right ? ` (the notebook's ${full})` : ''
      return `- ${wrong} → "${rename.right}"${known}`
    })
    .join('\n')
}

/** A rewrite carries a fix; it does not shrink the notes to a fragment or drop the sections. */
export function plausibleRewrite(rewritten: string, original: string): boolean {
  if (rewritten.trim().length < Math.floor(original.trim().length * 0.6)) return false
  return !original.includes('## ') || rewritten.includes('## ')
}

/** The model's rewrite of the write-up, streamed through `onText` as it comes. */
export async function rewriteWithModel(
  input: { summary: string; renames: string },
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const content = await readPromptFile(PROMPT_FILE)
  const { output: prompt } = renderPromptFile(content, 'transcript-rename.prompt.md', {
    user: { input: input.summary },
    renames: { text: input.renames },
  })
  let streamError: unknown
  const stream = streamText({
    ...aiModel('reasoning'),
    abortSignal: signal,
    prompt,
    timeout: 20 * 60 * 1000, // 20 min — backstop only; the idle guard fails wedges fast
    onError: ({ error }) => {
      streamError ??= error
    },
  })
  let text = ''
  for await (const delta of stream.textStream) {
    text += delta
    onText(delta)
  }
  if (streamError !== undefined) throw streamError
  return text.trim()
}
