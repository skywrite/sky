/**
 * What a matched name owes the text.
 *
 * The analysis returns two things about people — who was there and who was
 * discussed, each matched to a contact — and, separately, the issues to fix
 * in the transcript. Nothing tied the two: the model could match "Tanesha"
 * to Tanisha Patel for the rel list and raise no issue for the spelling, and
 * the transcript kept "Tanesha" — on into the write-up, whose prompt trusts
 * the transcript's names. So every person the analysis returns carries the
 * spellings the transcript got wrong for them, and this module turns those
 * into corrections the deterministic pass applies like any other
 * high-confidence fix. The match is the evidence; the correction follows
 * from it in code, not at the model's discretion.
 *
 * The target of a one-word mishearing is the one token of the contact's
 * name it stands for — "Tanesha" becomes "Tanisha", not "Tanisha Patel",
 * because a first name is what the speaker said. The token is picked by
 * string similarity, the first token on a tie, so a misheard surname lands
 * on the surname. A mishearing of more than one word becomes the full name.
 *
 * Skipped, and why:
 * - a spelling an issue already covers — the model's own fix, or the
 *   review's answer, rules that term;
 * - a spelling that is the contact's own token, or differs only in case —
 *   nothing to correct;
 * - a spelling under the replacer's minimum length — too promiscuous;
 * - a spelling the transcript does not contain — the model listed a form it
 *   had already corrected in its head;
 * - a contact named by a handle (`org/handle`) — no plain token to land on.
 */

import { compareTwoStrings } from 'string-similarity'
import { countOccurrences, MIN_NEEDLE_LENGTH } from './applyCorrections.ts'
import { normalizeTerm } from './dedupeIssues.ts'

/** One person as the analysis returns them: the contact's name and the transcript's misspellings of it. */
export interface PersonMatch {
  name: string
  misheard: string[]
}

/** The shapes people have come back in: bare names before the misheard list existed, objects since. */
export type RawPersonMatch = string | { name: string; misheard?: string[] | null }

/** Corrections the replacer applies, plus who they stand for, for the log line. */
export interface MisheardCorrection {
  originalText: string
  suggestedFix: string
  person: string
  occurrences: number
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Trailing and leading punctuation the model may have carried along ("Tanesha,"); internal marks (O'Brien) stay. */
const trimPunctuation = (text: string): string => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

const isHandle = (name: string): boolean => name.includes('/')

/** Either shape, normalized: blank names dropped, misspellings trimmed and deduped per person. */
export function toPersonMatches(entries: RawPersonMatch[]): PersonMatch[] {
  const people: PersonMatch[] = []
  for (const entry of entries) {
    const name = collapse(typeof entry === 'string' ? entry : entry.name)
    if (!name) continue
    const misheard: string[] = []
    for (const raw of typeof entry === 'string' ? [] : (entry.misheard ?? [])) {
      const spelling = trimPunctuation(collapse(raw))
      if (spelling && !misheard.some((m) => normalizeTerm(m) === normalizeTerm(spelling))) misheard.push(spelling)
    }
    people.push({ name, misheard })
  }
  return people
}

/** The contact-name token a one-word mishearing stands for; the whole name for a longer one. */
function targetFor(misheard: string, name: string): string {
  if (misheard.includes(' ')) return name
  const tokens = name.split(' ')
  let best = tokens[0]
  let bestScore = -1
  for (const token of tokens) {
    const score = compareTwoStrings(misheard.toLowerCase(), token.toLowerCase())
    if (score > bestScore) {
      best = token
      bestScore = score
    }
  }
  return best
}

/**
 * The corrections the matched people owe the transcript. `covered` is the
 * text of the issues already raised — those terms are left to their issue.
 */
export function misheardCorrections(
  people: PersonMatch[],
  transcript: string,
  covered: Iterable<string> = [],
): MisheardCorrection[] {
  const taken = new Set<string>()
  for (const term of covered) taken.add(normalizeTerm(term))

  const corrections: MisheardCorrection[] = []
  for (const person of people) {
    if (isHandle(person.name)) continue
    for (const spelling of person.misheard) {
      if (spelling.length < MIN_NEEDLE_LENGTH) continue
      const key = normalizeTerm(spelling)
      if (taken.has(key)) continue
      const target = targetFor(spelling, person.name)
      if (normalizeTerm(target) === key) continue
      const occurrences = countOccurrences(transcript, spelling)
      if (occurrences === 0) continue
      taken.add(key)
      corrections.push({ originalText: spelling, suggestedFix: target, person: person.name, occurrences })
    }
  }
  return corrections
}
