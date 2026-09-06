/**
 * Persistent correction glossary — the user's past rulings from interactive
 * transcript review, replayed into every future analysis run so settled terms
 * are corrected at HIGH confidence (or left alone) instead of re-asked.
 *
 * Two kinds of ruling enter it: the person's answers at review, and the
 * high-confidence name fixes that landed on a contact (lib/contactNames.ts) —
 * a mishearing of a known person's name, fixed once, is fixed for good and
 * reaches the transcriber's vocabulary. Every other auto-fix is applied once
 * and forgotten.
 *
 * Lives as hand-editable JSON under DIR_STATE (machine state, not the
 * notebook); editing or deleting the file is the unlearn path. A malformed
 * file loads as null and is never overwritten — a bad hand-edit must not cost
 * the user their glossary.
 *
 * Growth policy: entries never expire from the file — successful confirmed
 * corrections are invisible to review (they fire silently), so time-based
 * eviction would kill the best entries first. Instead, touchLastSeen() marks
 * entries relevant to each transcript, and capForPrompt() bounds what renders
 * into the prompt. Storage aging (archiving count-1 entries whose touched
 * lastSeen goes ~180 days stale) is deliberate future work for when the render
 * caps first trigger.
 */

import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE } from '#config'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { normalizeTerm } from './dedupeIssues.ts'

export const GLOSSARY_FILE = path.join(DIR_STATE, 'transcript', 'glossary.json')

export interface GlossaryEntry {
  wrong: string
  /** Present on 'correct' entries: the confirmed replacement. */
  right?: string
  action: 'correct' | 'keep'
  count: number
  firstSeen: string
  lastSeen: string
}

export interface Glossary {
  version: 1
  entries: GlossaryEntry[]
}

/** A single review decision worth remembering. `right: null` means keep as-is. */
export interface GlossaryRuling {
  wrong: string
  right: string | null
}

/**
 * Issue types whose text is a stable term worth remembering. Context-bound
 * types (inaudible, crosstalk) and speech artifacts (filler, stutter, false
 * starts) never generalize across transcripts.
 */
const DURABLE_TYPES = new Set(['unclear', 'technical', 'name'])

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Only term-shaped text generalizes: a name, a product, a short bit of jargon.
 * Sentence-level spans never recur verbatim, and replaying them onto
 * merely-similar sentences at HIGH confidence is worse than useless. Internal
 * periods (Node.js) are fine; clause punctuation or length marks a sentence.
 */
function isTermShaped(text: string): boolean {
  if (/[,;:!?]/.test(text)) return false
  if (/\.(\s|$)/.test(text)) return false
  return text.split(/\s+/).length <= 3
}

/**
 * Entity-shaped text earns confirmed-tier replay; everything else is ordinary
 * English that was misheard in one context, and replaying it blindly would
 * corrupt legitimate uses of the words. A single word counts with any capital
 * (Novack). A multi-word span needs a capital past the sentence-initial
 * position — inside the first word (NovaPay) or on a later word (Jane Doh) —
 * because a fragment like "He said maybe" is capitalized for starting a
 * sentence, not for naming anything.
 */
function isEntityShaped(text: string): boolean {
  const words = collapseWhitespace(text).split(' ')
  if (words.length === 1) return /\p{Lu}/u.test(text)
  return /\p{Lu}/u.test(words[0].slice(1)) || words.slice(1).some((word) => /\p{Lu}/u.test(word))
}

/**
 * A correction that merely trims words off an edge of the wrong text is an
 * artifact deletion (caption bleed like a trailing "Thanks"), not a term —
 * the exact padded span never recurs. Word-level on purpose: a character-level
 * check would misclassify real fixes like "Novaks" → "Novak".
 */
function isEdgeTrim(wrong: string, right: string): boolean {
  const wrongWords = collapseWhitespace(wrong).split(' ')
  const rightWords = collapseWhitespace(right).split(' ')
  if (rightWords.length >= wrongWords.length) return false
  const matchesAt = (offset: number) => rightWords.every((word, i) => wrongWords[i + offset] === word)
  return matchesAt(0) || matchesAt(wrongWords.length - rightWords.length)
}

export function emptyGlossary(): Glossary {
  return { version: 1, entries: [] }
}

/** Null on malformed input — callers must then avoid saving over the file. */
export function parseGlossary(text: string): Glossary | null {
  let data: { entries?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || !Array.isArray(data.entries)) return null
  const entries = (data.entries as GlossaryEntry[]).filter(
    (e) =>
      typeof e?.wrong === 'string' &&
      e.wrong.trim() !== '' &&
      (e.action === 'correct' ? typeof e.right === 'string' && e.right !== '' : e.action === 'keep'),
  )
  return { version: 1, entries }
}

/** Missing file → empty glossary. Malformed file → null (protect it from overwrites). */
export async function loadGlossary(filePath: string = GLOSSARY_FILE): Promise<Glossary | null> {
  let text: string
  try {
    text = await readTextFile(filePath)
  } catch {
    return emptyGlossary()
  }
  return parseGlossary(text)
}

export async function saveGlossary(glossary: Glossary, filePath: string = GLOSSARY_FILE): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeTextFile(filePath, JSON.stringify(glossary, null, 2) + '\n')
}

/**
 * Turn the user's review decisions into durable rulings.
 *
 * - accept/custom with a non-empty correction → confirmed correction
 * - correcting to the very same text → keep (the user is saying "it's right")
 * - skip → keep (the user declined to change it; stop flagging it)
 * - deletions (empty corrections) are dropped — they don't generalize
 * - sentence-shaped spans are dropped — only term-shaped text recurs
 * - edge-trims (right = wrong minus edge words) are dropped — caption-bleed
 *   artifacts, not terms
 * - corrections where neither side is entity-shaped are dropped — a standing
 *   rule for ordinary English (works → worked) misfires on legitimate uses
 */
export function buildRulings(
  issues: Array<{ type: string; originalText: string }>,
  corrections: Array<{ issueIndex: number; correction: string; action: 'accept' | 'custom' | 'skip' }>,
): GlossaryRuling[] {
  const rulings: GlossaryRuling[] = []
  for (const c of corrections) {
    const issue = issues[c.issueIndex]
    if (!issue || !DURABLE_TYPES.has(issue.type)) continue
    const wrong = issue.originalText.trim()
    if (wrong === '' || !isTermShaped(wrong)) continue
    if (c.action === 'skip') {
      rulings.push({ wrong, right: null })
      continue
    }
    const right = c.correction.trim()
    if (right === '') continue
    // Whitespace-insensitive but case-SENSITIVE: retyping the same text means
    // "it's right as-is", while a casing change ("sky oss" → "Sky OSS") is a
    // deliberate correction worth remembering.
    if (collapseWhitespace(right) === collapseWhitespace(wrong)) {
      rulings.push({ wrong, right: null })
      continue
    }
    if (isEdgeTrim(wrong, right)) continue
    if (!isEntityShaped(wrong) && !isEntityShaped(right)) continue
    rulings.push({ wrong, right })
  }
  return rulings
}

/** Merge rulings into the glossary in place. Latest ruling wins per term. */
export function applyRulings(glossary: Glossary, rulings: GlossaryRuling[], today: string): void {
  for (const ruling of rulings) {
    const wrongKey = normalizeTerm(ruling.wrong)
    const entry = glossary.entries.find((e) => normalizeTerm(e.wrong) === wrongKey)
    if (!entry) {
      glossary.entries.push({
        wrong: ruling.wrong,
        ...(ruling.right === null ? {} : { right: ruling.right }),
        action: ruling.right === null ? 'keep' : 'correct',
        count: 1,
        firstSeen: today,
        lastSeen: today,
      })
      continue
    }
    entry.count += 1
    entry.lastSeen = today
    if (ruling.right === null) {
      entry.action = 'keep'
      delete entry.right
    } else {
      entry.action = 'correct'
      entry.right = ruling.right
    }
  }
}

/**
 * Bump lastSeen on every entry whose wrong or right side appears in the
 * transcript, making lastSeen mean "last relevant" rather than "last
 * hand-ruled" — review never re-surfaces a correction that fires, so without
 * this the entries doing the most work look permanently stale. Returns how
 * many entries changed (same-day repeats don't count, so a no-op run doesn't
 * force a save).
 */
export function touchLastSeen(glossary: Glossary, transcript: string, today: string): number {
  const haystack = normalizeTerm(transcript)
  let touched = 0
  for (const entry of glossary.entries) {
    if (entry.lastSeen === today) continue
    const seen =
      haystack.includes(normalizeTerm(entry.wrong)) ||
      (entry.right !== undefined && haystack.includes(normalizeTerm(entry.right)))
    if (seen) {
      entry.lastSeen = today
      touched += 1
    }
  }
  return touched
}

export interface RenderCaps {
  confirmed: number
  hints: number
}

export const DEFAULT_RENDER_CAPS: RenderCaps = { confirmed: 150, hints: 60 }

/**
 * Bound what renders into the prompt without touching the file: keeps are
 * uncapped (one suppression line each), confirmed and hint corrections keep
 * the top entries by count then lastSeen — hints tightest, since every hint
 * line asks the model for a context judgment and they degrade first. Callers
 * log rendered vs total so truncation is never silent.
 */
export function capForPrompt(
  glossary: Glossary,
  caps: RenderCaps = DEFAULT_RENDER_CAPS,
): { capped: Glossary; total: number; rendered: number } {
  const byPriority = (a: GlossaryEntry, b: GlossaryEntry) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen)
  const corrects = glossary.entries.filter((e) => e.action === 'correct')
  const confirmed = corrects.filter((e) => isEntityShaped(e.wrong))
  const hints = corrects.filter((e) => !isEntityShaped(e.wrong))
  const selected = new Set<GlossaryEntry>([
    ...glossary.entries.filter((e) => e.action === 'keep'),
    ...confirmed.toSorted(byPriority).slice(0, caps.confirmed),
    ...hints.toSorted(byPriority).slice(0, caps.hints),
  ])
  return {
    capped: { version: 1, entries: glossary.entries.filter((e) => selected.has(e)) },
    total: glossary.entries.length,
    rendered: selected.size,
  }
}

/**
 * The transcription keyword list: the settled vocabulary a speech model
 * should know before hearing the audio — rights of corrections plus kept
 * wrongs, entity-shaped only, since feeding it one-off phrase repairs
 * would bias recognition toward false positives. Deduped case-insensitively
 * with the newest lastSeen winning, so a future cap would keep living terms.
 */
export function glossaryKeywords(glossary: Glossary): string[] {
  const candidates = glossary.entries
    .toSorted((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .map((e) => (e.action === 'correct' ? e.right : e.wrong))
    .filter((term): term is string => term !== undefined && isEntityShaped(term))
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const term of candidates) {
    const key = normalizeTerm(term)
    if (!seen.has(key)) {
      seen.add(key)
      keywords.push(term)
    }
  }
  return keywords
}

/** Prompt block for the analysis phase. */
export function renderGlossary(glossary: Glossary): string {
  if (glossary.entries.length === 0) return '(none yet)'

  const corrects = glossary.entries.filter((e) => e.action === 'correct')
  const confirmed = corrects.filter((e) => isEntityShaped(e.wrong))
  const hints = corrects.filter((e) => !isEntityShaped(e.wrong))
  const keeps = glossary.entries.filter((e) => e.action === 'keep')
  const entryLine = (e: GlossaryEntry) => `- "${e.wrong}" → "${e.right}" (confirmed ${e.count}×, last ${e.lastSeen})`

  const sections: string[][] = []
  if (confirmed.length > 0) {
    sections.push(['Confirmed corrections (apply at HIGH confidence, do not ask):', ...confirmed.map(entryLine)])
  }
  if (hints.length > 0) {
    sections.push([
      'Sounds-like hints (correct only where context clearly means the entity; otherwise ask, suggesting this fix):',
      ...hints.map(entryLine),
    ])
  }
  if (keeps.length > 0) {
    sections.push(['Leave as-is (do not flag):', ...keeps.map((e) => `- "${e.wrong}"`)])
  }
  return sections.map((section) => section.join('\n')).join('\n\n')
}
