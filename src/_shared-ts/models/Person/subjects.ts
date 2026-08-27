/**
 * Subject discovery for the person-facts distiller: which profiles does a
 * finished conversation actually concern?
 *
 * Deterministic by design — the transcript is matched against the people
 * index (every profile's name list, served by the notebook service), and
 * the winners' current profiles ride into the distill prompt. The model
 * then judges materiality (a matched name is a candidate, not a
 * conclusion); this module only decides who is even on the table, so a
 * person it misses can still surface through the distiller's unlisted
 * lane, while a person it can't resolve can never be written to at all.
 *
 * Both dependencies are injected — the index and the document reader — so
 * the caller decides the transport (the service in production, fixtures in
 * tests) and this module never touches people/ directories itself. One
 * known gap: the index carries the profiles' name lists but not the legacy
 * `alt:` field, so an alt-only nickname won't match until it graduates
 * into the name list.
 */

import { normalizeName } from '#shared/models/Store/normalize.ts'

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

/** Profiles are small, but each one rides the prompt — keep the table tight. */
const DEFAULT_LIMIT = 6

export interface FindPersonSubjectsInput {
  transcript: string
  /** The people index to match against */
  index: PersonIndexEntry[]
  /** Fetch a profile's current text; null when unavailable */
  readDocument: (path: string) => Promise<string | null>
  /** Names whose entries are never subjects — the user themself */
  excludeNames?: string[]
  limit?: number
}

/**
 * Match the transcript against every indexed person name and return the
 * most-mentioned people with their profiles. Never throws — an entry whose
 * profile can't be read is dropped, and no matches means no subjects.
 */
export async function findPersonSubjects(input: FindPersonSubjectsInput): Promise<PersonSubject[]> {
  if (!input.transcript.trim()) return []

  const excluded = new Set((input.excludeNames ?? []).map(normalizeName).filter(Boolean))
  const lower = input.transcript.toLowerCase()

  const matched: Array<{ entry: PersonIndexEntry; mentions: number }> = []
  for (const entry of input.index) {
    if (entry.names.some((n) => excluded.has(normalizeName(n)))) continue

    // A person's aliases all count toward the same profile; the strongest
    // alias sets the rank ("Bob" beating "Bob Smith" is the same Bob).
    let mentions = 0
    for (const name of entry.names) {
      const normalized = normalizeName(name)
      if (normalized.length < MIN_NAME_CHARS) continue
      mentions = Math.max(mentions, countMentions(input.transcript, lower, normalized))
    }
    if (mentions > 0) matched.push({ entry, mentions })
  }

  matched.sort((a, b) => b.mentions - a.mentions || a.entry.name.localeCompare(b.entry.name))

  const subjects: PersonSubject[] = []
  for (const { entry } of matched.slice(0, input.limit ?? DEFAULT_LIMIT)) {
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
 * Whole-word mentions of a normalized name. Multi-word names match
 * case-insensitively; a single-word name must appear capitalized ("Will",
 * not "will") — without the case signal a person named Will would match
 * every modal verb in the chat.
 */
function countMentions(transcript: string, lowerTranscript: string, normalizedName: string): number {
  const words = normalizedName.split(' ')
  if (words.length === 1) {
    const word = words[0]
    const pattern = `(?<![A-Za-z0-9])${escapeRegExp(word[0].toUpperCase() + word.slice(1))}(?![a-z0-9])`
    return (transcript.match(new RegExp(pattern, 'g')) ?? []).length
  }
  const pattern = `(?<![a-z0-9])${words.map(escapeRegExp).join('\\s+')}(?![a-z0-9])`
  return (lowerTranscript.match(new RegExp(pattern, 'g')) ?? []).length
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
