/**
 * Persistent correction glossary — the user's past rulings from interactive
 * transcript review, replayed into every future analysis run so settled terms
 * are corrected at HIGH confidence (or left alone) instead of re-asked.
 *
 * Lives as hand-editable JSON under DIR_STATE (machine state, not the
 * notebook); editing or deleting the file is the unlearn path. A malformed
 * file loads as null and is never overwritten — a bad hand-edit must not cost
 * the user their glossary.
 */

import * as path from 'node:path'
import { mkdir } from 'node:fs/promises'
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
 * Name-shaped wrongs (any uppercase letter) replay as confirmed replacements.
 * All-lowercase wrongs are ordinary English that was misheard as an entity in
 * one context — replaying those blindly would corrupt legitimate uses of the
 * words, so they render as context-judged hints instead.
 */
function isNameShaped(text: string): boolean {
  return /\p{Lu}/u.test(text)
}

/** Prompt block for the analysis phase. */
export function renderGlossary(glossary: Glossary): string {
  if (glossary.entries.length === 0) return '(none yet)'

  const corrects = glossary.entries.filter((e) => e.action === 'correct')
  const confirmed = corrects.filter((e) => isNameShaped(e.wrong))
  const hints = corrects.filter((e) => !isNameShaped(e.wrong))
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
