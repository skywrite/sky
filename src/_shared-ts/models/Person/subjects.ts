/**
 * Subject discovery for the person-facts distiller: which profiles does a
 * finished conversation actually concern?
 *
 * Deterministic by design — the transcript is matched against the people
 * index (every profile's name list, served by the notebook service), and
 * the winners' current profiles ride into the distill prompt. The model
 * then judges materiality and identity (a matched name is a candidate, not
 * a conclusion); this module only decides who is even on the table, so a
 * person it misses can still surface through the distiller's unlisted
 * lane, while a person it can't resolve can never be written to at all.
 * The unlisted lane is screened back against the same index before any
 * host renders it, so a profile that exists but never rode the prompt is
 * reported as existing, never as a person:new to create.
 *
 * Two kinds of evidence, ranked in this order:
 * - a full multi-word name ("Sam Rivera") — unambiguous, always kept;
 * - a bare handle — a first name or a single-word alias ("Sam") — which is
 *   ambiguous, so it makes EVERY profile answering to it a candidate,
 *   ranked by interaction score and cut to the top few per handle. An
 *   explicit single-word alias in a profile's name list is evidence like
 *   any other first name, never authority: a legacy "Sam" alias on a
 *   rarely-seen profile must not claim every Sam in the notebook. A handle
 *   only counts capitalized, and not at all when the same word also occurs
 *   in lowercase in the transcript — then it is prose ("The", "Will",
 *   "Art") wearing a sentence-initial capital, not a name.
 *
 * Both dependencies are injected — the index and the document reader — so
 * the caller decides the transport (the service in production, fixtures in
 * tests) and this module never touches people/ directories itself. One
 * known gap: the index carries the profiles' name lists but not the legacy
 * `alt:` field, so an alt-only nickname won't match until it graduates
 * into the name list.
 */

import { normalizeName } from '#shared/models/Store/normalize.ts'
import type { UnlistedPerson } from './write.ts'

/** One profile in the people index — the `allPeople { name names path }` row. */
export interface PersonIndexEntry {
  /** Canonical name — the profile's name list, index 0 */
  name: string
  /** Every known name and alias */
  names: string[]
  /** Notebook-relative profile path */
  path: string
}

/** A discovered subject: a resolvable person plus their current profile. */
export interface PersonSubject {
  name: string
  path: string
  /** The profile as it stands, frontmatter included — the distiller's baseline */
  markdown: string
}

/**
 * Below this many characters a normalized name is unmatchable — two-letter
 * handles collide with ordinary prose too often to trust.
 */
const MIN_NAME_CHARS = 3

/**
 * Profiles are small — a few hundred bytes as a rule — but each one rides
 * the prompt, so the ranked list is still cut. The cut is a runaway backstop
 * for a text naming dozens of people, never a budget to tune down: a matched
 * profile left out of the prompt reads to the model as "no profile", and
 * the person comes back unlisted.
 */
const DEFAULT_LIMIT = 32

/**
 * A bare handle shared by several profiles keeps this many of them, by
 * interaction score — enough for the model to see the likely person and
 * the runner-up, never a page of namesakes.
 */
const PER_HANDLE_LIMIT = 2

export interface FindPersonSubjectsInput {
  transcript: string
  /** The people index to match against */
  index: PersonIndexEntry[]
  /** Fetch a profile's current text; null when unavailable */
  readDocument: (path: string) => Promise<string | null>
  /** Names whose entries are never subjects — the user themself */
  excludeNames?: string[]
  /**
   * Interaction score for a raw name, zero when unknown — ranks the
   * profiles sharing a bare handle. Without it, namesakes tie and the cut
   * falls back to name order.
   */
  scoreFor?: (name: string) => number
  limit?: number
}

interface Candidate {
  entry: PersonIndexEntry
  /** Full multi-word name mentions — the strongest alias sets it */
  full: number
  /** Bare handle mentions — the strongest handle sets it */
  bare: number
  /** The handles this entry answers to that the transcript used */
  handles: string[]
  score: number
}

/**
 * Match the transcript against every indexed person name and return the
 * people it most plausibly concerns with their profiles. Never throws — an
 * entry whose profile can't be read is dropped, and no matches means no
 * subjects.
 */
export async function findPersonSubjects(input: FindPersonSubjectsInput): Promise<PersonSubject[]> {
  if (!input.transcript.trim()) return []

  const excluded = new Set((input.excludeNames ?? []).map(normalizeName).filter(Boolean))
  const lower = input.transcript.toLowerCase()
  const scoreFor = input.scoreFor ?? (() => 0)
  // Namesakes share a handle; count each handle once per transcript.
  const bareCounts = new Map<string, number>()
  const countBare = (handle: string): number => {
    let count = bareCounts.get(handle)
    if (count === undefined) {
      count = countNameWord(input.transcript, handle)
      bareCounts.set(handle, count)
    }
    return count
  }

  const matched: Candidate[] = []
  for (const entry of input.index) {
    if (entry.names.some((n) => excluded.has(normalizeName(n)))) continue

    // A person's aliases all count toward the same profile; the strongest
    // alias sets the rank ("Bob" beating "Bob Smith" is the same Bob).
    let full = 0
    let bare = 0
    const handles = new Set<string>()
    for (const name of entry.names) {
      const normalized = normalizeName(name)
      if (normalized.length < MIN_NAME_CHARS) continue
      const words = normalized.split(' ')
      if (words.length > 1) full = Math.max(full, countPhrase(lower, words))
      const handle = words[0]
      if (handle.length < MIN_NAME_CHARS) continue
      const count = countBare(handle)
      if (count > 0) {
        handles.add(handle)
        bare = Math.max(bare, count)
      }
    }
    if (full === 0 && bare === 0) continue
    let score = 0
    for (const name of entry.names) score += scoreFor(name)
    matched.push({ entry, full, bare, handles: Array.from(handles), score })
  }

  // A handle shared by several profiles keeps only its top few by score;
  // a profile named in full is never cut.
  const kept = new Set<PersonIndexEntry>()
  for (const candidate of matched) if (candidate.full > 0) kept.add(candidate.entry)
  const byHandle = new Map<string, Candidate[]>()
  for (const candidate of matched) {
    for (const handle of candidate.handles) {
      const group = byHandle.get(handle)
      if (group) group.push(candidate)
      else byHandle.set(handle, [candidate])
    }
  }
  for (const group of byHandle.values()) {
    group.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    for (const candidate of group.slice(0, PER_HANDLE_LIMIT)) kept.add(candidate.entry)
  }

  const ranked = matched
    .filter((c) => kept.has(c.entry))
    .sort((a, b) => b.full - a.full || b.bare - a.bare || b.score - a.score || a.entry.name.localeCompare(b.entry.name))

  const subjects: PersonSubject[] = []
  for (const { entry } of ranked.slice(0, input.limit ?? DEFAULT_LIMIT)) {
    try {
      const markdown = await input.readDocument(entry.path)
      if (markdown) subjects.push({ name: entry.name, path: entry.path, markdown })
    } catch {
      // An unreadable profile is not a subject — it can't be shown or written.
    }
  }
  return subjects
}

/**
 * Every indexed profile answering to a name the model produced: an exact
 * alias, an alias holding every word of a multi-word name ("Sam Ortiz" →
 * "Sam Rivera Ortiz"), or — for a single word — an alias it opens or closes
 * ("Sam" → "Sam Rivera"; "Rivera" → "Sam Rivera"). This is the "does a
 * profile exist?" check behind the unlisted lane, so it errs toward
 * matching: a false match costs one person:new hint, a miss suggests
 * creating a duplicate.
 */
export function profilesAnsweringTo(name: string, index: PersonIndexEntry[]): PersonIndexEntry[] {
  const normalized = normalizeName(name)
  if (normalized.length < MIN_NAME_CHARS) return []
  const words = normalized.split(' ')
  const answers = (alias: string): boolean => {
    const aliasWords = normalizeName(alias).split(' ')
    if (words.length === 1) return aliasWords[0] === words[0] || aliasWords[aliasWords.length - 1] === words[0]
    return words.every((word) => aliasWords.includes(word))
  }
  return index.filter((entry) => entry.names.some(answers))
}

/**
 * Screen the distiller's unlisted people against the index before any host
 * renders them: a qualifier the model tacked on is dropped ("Sam Rivera
 * (Atlas)" → "Sam Rivera"), duplicates collapse to the first, and a name
 * existing profiles answer to carries them, so the host reports the profile
 * instead of suggesting a duplicate person:new. Order stays the model's.
 */
export function screenUnlisted(unlisted: UnlistedPerson[], index: PersonIndexEntry[]): UnlistedPerson[] {
  const seen = new Set<string>()
  const screened: UnlistedPerson[] = []
  for (const person of unlisted) {
    const name = stripQualifier(person.name)
    const key = normalizeName(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const existing = profilesAnsweringTo(name, index).map((entry) => entry.name)
    screened.push(existing.length > 0 ? { name, gist: person.gist, existing } : { name, gist: person.gist })
  }
  return screened
}

/** "Sam Rivera (Atlas)" → "Sam Rivera"; a name that is nothing but a qualifier keeps itself. */
function stripQualifier(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return stripped || name.trim()
}

/** Whole-phrase mentions of a normalized multi-word name, case-insensitively. */
function countPhrase(lowerTranscript: string, words: string[]): number {
  const pattern = `(?<![a-z0-9])${words.map(escapeRegExp).join('\\s+')}(?![a-z0-9])`
  return (lowerTranscript.match(new RegExp(pattern, 'g')) ?? []).length
}

/**
 * Whole-word mentions of a bare handle, which must appear capitalized
 * ("Will", not "will") — without the case signal a person named Will would
 * match every modal verb in the chat. A word the transcript also uses in
 * lowercase is prose, not a name: its capitalized occurrences are sentence
 * starts ("The economics…", "Will you…"), and a profile whose first name is
 * "The" must not top the candidates of every chat.
 */
function countNameWord(transcript: string, word: string): number {
  if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`).test(transcript)) return 0
  const capitalized = escapeRegExp(word[0].toUpperCase() + word.slice(1))
  return (transcript.match(new RegExp(`(?<![A-Za-z0-9])${capitalized}(?![a-z0-9])`, 'g')) ?? []).length
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
