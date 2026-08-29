/**
 * The write half of person profiles: applying save-time distiller ops to
 * people/ files — the notebook's CRM. Design and format law: docs/README.md.
 *
 * The distiller (lib/notebook/enrich/distillPersonFacts.ts) reads a finished
 * conversation against the profiles of the people it discussed and returns
 * ops; this module is the only thing that turns them into edits. Unlike
 * ai/memory/, people/ is hand-authored space, so the discipline here is
 * structural rather than a write license: NOTHING IS DELETED UNQUOTED. The
 * AI owns exactly one section — ## Overview, rewritten wholesale — while
 * every other section only ever gains appended lines, or has one line
 * swapped for a corrected one when the distiller quotes it verbatim. Every
 * line the AI writes obeys the format law in format.ts: one fact per line,
 * a word cap, bullets. A line over the cap is refused, never trimmed.
 * Frontmatter fields fill only when empty. The one sanctioned mutation
 * beyond that is the name list, whose order is a notebook-wide convention
 * (index 0 preferred, index 1 legal): an explicit "goes by" may reorder it.
 * Touching a file also canonicalizes stray section headings (Family /
 * Relationships → Family, Contact/Links → Info, About → Background) — a
 * rename-and-merge that moves content, never drops it — and drops a body
 * line that merely echoes its own heading.
 *
 * All disk I/O goes through an injected DocumentIO — in production the
 * notebook service's documentContent/saveDocument pair (lib/service/
 * documents.ts), so no profile path is ever touched from outside the
 * service. The transport's version handle makes every write conflict-
 * checked: a hand edit or another session landing mid-save surfaces as a
 * conflict, and the ops re-apply against the fresh content once before
 * giving up. Every op, applied or skipped, returns an outcome the host
 * renders (the 👤 lines) and the transcript's context log records.
 */

import { normalizeName } from '#shared/models/Store/normalize.ts'
import { bullet, isBullet, lineKey, MAX_OVERVIEW_LINES, MAX_WORDS_PER_LINE, overCap, toFactLines } from './format.ts'
import PersonDocument from './mod.ts'

// -----------------------------------------------------------------------------
// Document transport — how profile bytes are read and written
// -----------------------------------------------------------------------------

export interface DocumentSnapshot {
  /** Notebook-relative path, the form the service's queries return */
  path: string
  content: string
  /** Content-hash handle for optimistic concurrency */
  version: number
}

export type DocumentSaveResult =
  /** Written; the store's watcher picks the change up from disk */
  | { saved: true }
  /** The file changed since the version was read — here is the current state */
  | { saved: false; current: DocumentSnapshot }

/**
 * The applier's whole world: read a document, save it back under the
 * version that was read. Production hands in the notebook service's
 * GraphQL transport; tests hand in a map.
 */
export interface DocumentIO {
  read(path: string): Promise<DocumentSnapshot | null>
  save(path: string, content: string, version: number): Promise<DocumentSaveResult>
}

// -----------------------------------------------------------------------------
// Ops — what a distillation may ask for
// -----------------------------------------------------------------------------

/** Sections that accept appended and replaced lines. ## Overview is rewritten, never appended. */
export const APPEND_SECTIONS = ['Background', 'Family', 'Info'] as const
export type AppendSection = (typeof APPEND_SECTIONS)[number]

/** Frontmatter fields the distiller may fill — when empty, never over a value. */
export const FILL_FIELDS = ['location', 'title', 'org'] as const
export type FillField = (typeof FILL_FIELDS)[number]

export type PersonOp =
  /** Replace (or create, as the first section) ## Overview wholesale: one fact per line */
  | { op: 'overview'; lines: string[] }
  /** Append one durable fact to an append-only section */
  | { op: 'note'; section: AppendSection; text: string }
  /** Swap one existing line, quoted verbatim, for a corrected one */
  | { op: 'replace'; section: AppendSection; old: string; text: string }
  /** Fill an empty frontmatter field */
  | { op: 'field'; field: FillField; value: string }
  /** Add a URL to sites: (deduped) */
  | { op: 'site'; url: string }
  /** Reorder the name list so this is index 0 — explicit "goes by" evidence only */
  | { op: 'preferred-name'; preferred: string }

/** Everything a distillation learned about one person. */
export interface PersonFacts {
  /** The profile's canonical name, exactly as the subject list gave it */
  name: string
  ops: PersonOp[]
}

/** A person materially discussed who has no profile — surfaced, never written. */
export interface UnlistedPerson {
  name: string
  /** One line of what the conversation established about them */
  gist: string
  /**
   * Canonical names of profiles that already answer to the name — set by the
   * screen against the people index, and the reason the hint reports them
   * instead of suggesting a duplicate person:new.
   */
  existing?: string[]
}

/** One op's fate, for the host's 👤 line and the transcript's context log. */
export interface PersonOpOutcome {
  op: PersonOp['op'] | 'unknown'
  person: string
  /** One-line human gist of what happened */
  summary: string
  outcome: 'applied' | 'skipped'
  /** Why a skipped op was skipped */
  reason?: string
}

/**
 * Runaway backstops. With up to 32 profiles riding the prompt, a long
 * meeting legitimately teaches something about half a dozen people; a
 * conversation teaching about more than this is vanishingly rare — past the
 * caps it's a model failure, and the excess is skipped visibly rather than
 * applied. One rich conversation about one person runs to eight ops once
 * an overview brings its field fills along (a dry run: overview, three
 * fields, two replaces, a note, a rename), so the per-person cap sits
 * above that.
 */
export const MAX_PEOPLE_PER_SAVE = 8
export const MAX_OPS_PER_PERSON = 10
/** Unlisted lines past this fold into one — a hint lane, never a roster. */
export const MAX_UNLISTED_PER_SAVE = 6

/** Verb per op for the hosts' 👤 exit lines. */
export const PERSON_VERBS: Record<string, string> = {
  overview: 'profiled',
  note: 'noted',
  replace: 'revised',
  field: 'filled',
  site: 'linked',
  'preferred-name': 'renamed',
  unknown: 'unlisted',
}

/**
 * One exit-summary line per outcome, shared by every host that applies
 * profile ops (ai:chat, meeting:new) so the 👤 block reads identically
 * everywhere. Hosts apply their own dim styling to skipped lines.
 */
export function formatPersonOpLine(o: PersonOpOutcome): { text: string; dim: boolean } {
  const verb = (PERSON_VERBS[o.op] ?? o.op).padEnd(10)
  const base = `👤 ${verb} ${o.person} — ${o.summary}`
  return o.outcome === 'skipped' ? { text: `${base} — skipped: ${o.reason}`, dim: true } : { text: base, dim: false }
}

// -----------------------------------------------------------------------------
// Section surgery — the body as preamble + ## sections
// -----------------------------------------------------------------------------

export interface BodySection {
  heading: string
  body: string
}

export interface SplitBody {
  /** Everything before the first ## heading: the # Name line and any lead prose */
  preamble: string
  sections: BodySection[]
}

/** Exactly h2 — ### subsections stay inside their parent section's body. */
const H2 = /^##(?!#)\s*(.*?)\s*$/
/** h3 and deeper, inside a section body. */
const SUBHEADING = /^\s*#{3,}\s/

export function splitBodySections(body: string): SplitBody {
  const preambleLines: string[] = []
  const sections: BodySection[] = []
  let current: { heading: string; lines: string[] } | null = null

  for (const line of body.split('\n')) {
    const match = line.match(H2)
    if (match) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() })
      current = { heading: match[1], lines: [] }
    } else if (current) {
      current.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() })

  return { preamble: preambleLines.join('\n').trimEnd(), sections }
}

/** Blank-line spacing is normalized; content passes through verbatim. */
export function joinBodySections(split: SplitBody): string {
  const parts: string[] = []
  if (split.preamble.trim()) parts.push(split.preamble.trimEnd())
  for (const s of split.sections) parts.push(s.body ? `## ${s.heading}\n\n${s.body}` : `## ${s.heading}`)
  return parts.join('\n\n') + '\n'
}

/**
 * Legacy heading spellings folded into the canonical set. Lowercase keys;
 * anything unmapped (dated sections, one-off headings) passes through
 * untouched — folding the ambiguous strays is not this rung's business.
 */
const CANONICAL_SECTIONS: Record<string, string> = {
  'family / relationships': 'Family',
  'family relationships': 'Family',
  contact: 'Info',
  links: 'Info',
  about: 'Background',
}

/**
 * Rename stray headings to their canonical names and merge same-named
 * sections (the rename can collide with an existing section, and messy
 * files carry literal duplicates). A merge appends the later section's
 * content to the earlier one — a move, never a delete. A body whose first
 * line only repeats its own heading loses that line: it is an echo an
 * earlier distiller left behind, not a fact.
 */
export function canonicalizeSections(split: SplitBody): SplitBody {
  const sections: BodySection[] = []
  const byKey = new Map<string, BodySection>()

  for (const s of split.sections) {
    const heading = CANONICAL_SECTIONS[s.heading.toLowerCase()] ?? s.heading
    const body = dropHeadingEcho(s.body, heading)
    const existing = byKey.get(heading.toLowerCase())
    if (existing) {
      existing.body = [existing.body, body].filter(Boolean).join('\n\n')
      continue
    }
    const next = { heading, body }
    byKey.set(heading.toLowerCase(), next)
    sections.push(next)
  }

  return { preamble: split.preamble, sections }
}

function dropHeadingEcho(body: string, heading: string): string {
  const lines = body.split('\n')
  const first = lines[0]?.trim().replace(/:$/, '').toLowerCase()
  if (first !== heading.toLowerCase()) return body
  return lines.slice(1).join('\n').trim()
}

function findSection(split: SplitBody, heading: string): BodySection | undefined {
  return split.sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())
}

// -----------------------------------------------------------------------------
// The pure core — ops against document text
// -----------------------------------------------------------------------------

export interface AppliedMarkdown {
  markdown: string
  outcomes: PersonOpOutcome[]
  /** Ops that actually changed the document; 0 means markdown is meaningless */
  applied: number
}

/**
 * Apply one person's ops to their profile text. Pure — same inputs, same
 * result — which is what lets a version conflict simply re-run it against
 * the fresh content. Ops that cannot apply (occupied field, duplicate
 * note, a line over the cap, over the op cap) come back skipped; the
 * returned markdown is only meaningful when `applied > 0`.
 */
export function applyOpsToMarkdown(markdown: string, ops: PersonOp[], person: string, today: string): AppliedMarkdown {
  const doc = PersonDocument.fromMarkdown(markdown)
  const split = canonicalizeSections(splitBodySections(doc.toMarkdown({ yaml: false })))
  const outcomes: PersonOpOutcome[] = []
  let applied = 0

  for (const [i, op] of ops.entries()) {
    if (i >= MAX_OPS_PER_PERSON) {
      outcomes.push({
        op: op.op,
        person,
        summary: opGist(op),
        outcome: 'skipped',
        reason: 'per-person op cap',
      })
      continue
    }
    try {
      const outcome = applyOp(op, doc, split, person)
      if (outcome.outcome === 'applied') applied += 1
      outcomes.push(outcome)
    } catch (err) {
      outcomes.push({
        op: op.op,
        person,
        summary: opGist(op),
        outcome: 'skipped',
        reason: (err as Error).message,
      })
    }
  }

  if (applied === 0) return { markdown, outcomes, applied }

  doc.yaml['updated'] = today
  // A fresh document re-runs constructor normalization (tags shape) and
  // serializes frontmatter in the standard field order — the "clean" half
  // of the mandate, and value-preserving throughout.
  const next = new PersonDocument(doc.yaml, joinBodySections(split))
  return { markdown: next.toMarkdown(), outcomes, applied }
}

// -----------------------------------------------------------------------------
// Applying — facts against the store, through the transport
// -----------------------------------------------------------------------------

/** A discovered subject: the profile the distiller was shown. */
export interface PersonSubjectRef {
  name: string
  path: string
}

export interface ApplyPersonFactsInput {
  facts: PersonFacts[]
  unlisted: UnlistedPerson[]
  /** The subjects the distiller saw — the only names that resolve to files */
  subjects: PersonSubjectRef[]
  /** YYYY-MM-DD stamped into updated: on any profile that changed */
  today: string
  /** The document transport — the notebook service in production */
  io: DocumentIO
}

/**
 * Apply distilled facts against the profiles. Never throws: an op that
 * cannot apply — unknown person, occupied field, duplicate note, transport
 * failure, over a cap — returns a skipped outcome instead, so one bad op
 * never costs the rest or the save itself.
 */
export async function applyPersonFacts(input: ApplyPersonFactsInput): Promise<PersonOpOutcome[]> {
  const outcomes: PersonOpOutcome[] = []
  const subjectsByName = new Map(input.subjects.map((s) => [normalizeName(s.name), s]))

  let people = 0
  for (const facts of input.facts) {
    if (facts.ops.length === 0) continue

    // A name outside the subject list has no file to edit — surfaced as the
    // same person:new hint an unlisted person gets, never guessed at a path.
    const subject = subjectsByName.get(normalizeName(facts.name))
    if (!subject) {
      outcomes.push({
        op: 'unknown',
        person: facts.name,
        summary: opGist(facts.ops[0]),
        outcome: 'skipped',
        reason: noProfileReason(facts.name),
      })
      continue
    }

    people += 1
    if (people > MAX_PEOPLE_PER_SAVE) {
      outcomes.push({
        op: facts.ops[0].op,
        person: subject.name,
        summary: `${facts.ops.length} op${facts.ops.length === 1 ? '' : 's'}`,
        outcome: 'skipped',
        reason: 'per-save people cap',
      })
      continue
    }

    outcomes.push(...(await applyToPerson(subject, facts.ops, input.today, input.io)))
  }

  for (const u of input.unlisted.slice(0, MAX_UNLISTED_PER_SAVE)) {
    outcomes.push({
      op: 'unknown',
      person: u.name,
      summary: u.gist,
      outcome: 'skipped',
      reason: u.existing && u.existing.length > 0 ? existingProfileReason(u.existing) : noProfileReason(u.name),
    })
  }
  const folded = input.unlisted.slice(MAX_UNLISTED_PER_SAVE)
  if (folded.length > 0) {
    outcomes.push({
      op: 'unknown',
      person: `${folded.length} more`,
      summary: folded.map((u) => u.name).join(', '),
      outcome: 'skipped',
      reason: 'per-save unlisted cap',
    })
  }

  return outcomes
}

function noProfileReason(name: string): string {
  return `no profile (sky person:new "${name}")`
}

/** The profiles a name already answers to — a few by name, the rest counted. */
function existingProfileReason(names: string[]): string {
  const more = names.length - 3
  return `profile exists: ${names.slice(0, 3).join(', ')}${more > 0 ? ` +${more} more` : ''}`
}

/** Best short description of an op, for outcomes that never reached a file. */
function opGist(op: PersonOp): string {
  switch (op.op) {
    case 'overview':
      return truncate(op.lines.join(' · '))
    case 'note':
      return truncate(op.text)
    case 'replace':
      return truncate(`${op.text} (was: ${op.old})`)
    case 'field':
      return `${op.field}: ${op.value}`
    case 'site':
      return op.url
    case 'preferred-name':
      return `goes by ${op.preferred}`
  }
}

function truncate(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

async function applyToPerson(
  subject: PersonSubjectRef,
  ops: PersonOp[],
  today: string,
  io: DocumentIO,
): Promise<PersonOpOutcome[]> {
  const skippedAll = (reason: string): PersonOpOutcome[] =>
    ops.map((op) => ({ op: op.op, person: subject.name, summary: opGist(op), outcome: 'skipped', reason }))

  try {
    const snapshot = await io.read(subject.path)
    if (!snapshot) return skippedAll('profile not found')

    let attempt = applyOpsToMarkdown(snapshot.content, ops, subject.name, today)
    if (attempt.applied === 0) return attempt.outcomes

    let result = await io.save(subject.path, attempt.markdown, snapshot.version)
    if (!result.saved) {
      // The file moved under us — a hand edit or another session. The ops
      // are re-runnable (dedupe, fill-empty), so re-apply against the
      // current content once; a second conflict means real contention and
      // the save yields rather than fight for the file.
      attempt = applyOpsToMarkdown(result.current.content, ops, subject.name, today)
      if (attempt.applied === 0) return attempt.outcomes
      result = await io.save(subject.path, attempt.markdown, result.current.version)
      if (!result.saved) return skippedAll('write conflict — the profile is being edited')
    }
    return attempt.outcomes
  } catch (err) {
    return skippedAll(`service error: ${(err as Error).message}`)
  }
}

function applyOp(op: PersonOp, doc: PersonDocument, split: SplitBody, person: string): PersonOpOutcome {
  const skipped = (summary: string, reason: string): PersonOpOutcome => ({
    op: op.op,
    person,
    summary,
    outcome: 'skipped',
    reason,
  })
  const applied = (summary: string): PersonOpOutcome => ({ op: op.op, person, summary, outcome: 'applied' })

  switch (op.op) {
    case 'overview': {
      // The whole section either becomes a conforming one or stays as it
      // is: a line over the cap refuses the op, so the current Overview is
      // never traded for a trimmed or partial one.
      const lines = toFactLines(op.lines)
      if (lines.length === 0) return skipped(opGist(op), 'empty overview')
      const long = overCap(lines)
      if (long) return skipped(opGist(op), overCapReason(long))
      if (lines.length > MAX_OVERVIEW_LINES) {
        return skipped(opGist(op), `${lines.length} lines, cap ${MAX_OVERVIEW_LINES}`)
      }
      const body = lines.map(bullet).join('\n')
      const existing = findSection(split, 'Overview')
      if (existing) existing.body = body
      else split.sections.unshift({ heading: 'Overview', body })
      return applied(truncate(lines.join(' · ')))
    }

    case 'note': {
      // A note that chained two facts lands as two bullets; each dedupes
      // on its own against every line already in the section.
      const lines = toFactLines(op.text)
      if (lines.length === 0) return skipped(opGist(op), 'empty note')
      const long = overCap(lines)
      if (long) return skipped(opGist(op), overCapReason(long))
      const section = findSection(split, op.section)
      const fresh = section ? lines.filter((line) => !sectionHasLine(section.body, line)) : lines
      if (fresh.length === 0) return skipped(`${opGist(op)} (${op.section})`, 'already noted')
      if (section) section.body = appendLines(section.body, fresh)
      else split.sections.push({ heading: op.section, body: fresh.map(bullet).join('\n') })
      return applied(`${truncate(fresh.join(' · '))} (${op.section})`)
    }

    case 'replace': {
      // No match, no write: the quote must equal a whole existing line
      // (marker, case, and terminal period aside). Headings are never a
      // target — a sub-heading swapped for a bullet would delete structure.
      const lines = toFactLines(op.text)
      if (lines.length === 0) return skipped(opGist(op), 'empty replacement')
      const long = overCap(lines)
      if (long) return skipped(opGist(op), overCapReason(long))
      const key = lineKey(op.old)
      if (!key) return skipped(opGist(op), 'empty old line')
      const section = findSection(split, op.section)
      if (!section) return skipped(opGist(op), `no ${op.section} section`)
      const rows = section.body.split('\n')
      const at = rows.findIndex((row) => lineKey(row) === key)
      if (at < 0) return skipped(opGist(op), 'old line not found')
      if (SUBHEADING.test(rows[at])) return skipped(opGist(op), 'old line is a heading')
      if (lines.length === 1 && lineKey(lines[0]) === key) return skipped(opGist(op), 'unchanged')
      rows.splice(at, 1, ...lines.map(bullet))
      section.body = rows.join('\n')
      return applied(`${truncate(`${lines.join(' · ')} (was: ${op.old})`)} (${op.section})`)
    }

    case 'field': {
      const value = op.value.trim()
      if (!value) return skipped(opGist(op), 'empty value')
      // org checks the accessor, not the raw key — orgs.current occupies it too.
      const occupied = op.field === 'org' ? Boolean(doc.org) : hasValue(doc.yaml[op.field])
      if (occupied) return skipped(opGist(op), `${op.field} already set`)
      doc.yaml[op.field] = value
      return applied(`${op.field}: ${value}`)
    }

    case 'site': {
      const url = op.url.trim()
      if (!/^https?:\/\//i.test(url)) return skipped(url, 'not a URL')
      if (doc.sites.has(url)) return skipped(url, 'already listed')
      doc.yaml['sites'] = [...Array.from(doc.sites), url]
      return applied(url)
    }

    case 'preferred-name': {
      const preferred = op.preferred.trim()
      if (!preferred) return skipped(opGist(op), 'empty name')
      const names = doc.names
      if (names.length > 0 && normalizeName(names[0]) === normalizeName(preferred)) {
        return skipped(opGist(op), 'already preferred')
      }
      // An existing entry keeps its hand-written casing when it moves to
      // the front; a new preferred name joins the list, dropping nothing.
      const match = names.find((n) => normalizeName(n) === normalizeName(preferred))
      const front = match ?? preferred
      doc.yaml['name'] = [front, ...names.filter((n) => n !== front)]
      return applied(`goes by ${front}`)
    }
  }
}

function overCapReason(line: string): string {
  return `over ${MAX_WORDS_PER_LINE} words: "${truncate(line, 40)}"`
}

/**
 * New bullets join the section's own body, above any ### sub-heading, so
 * a Background note never lands under whatever sub-section happens to be
 * last. Consecutive bullets stay one list; after prose, a blank line
 * separates.
 */
function appendLines(body: string, lines: string[]): string {
  const rows = body ? body.split('\n') : []
  const sub = rows.findIndex((row) => SUBHEADING.test(row))
  const head = sub < 0 ? rows : rows.slice(0, sub)
  const tail = sub < 0 ? [] : rows.slice(sub)
  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop()
  const last = head[head.length - 1]
  if (last !== undefined && !isBullet(last)) head.push('')
  head.push(...lines.map(bullet))
  if (tail.length > 0) head.push('')
  return [...head, ...tail].join('\n')
}

function sectionHasLine(body: string, text: string): boolean {
  const key = lineKey(text)
  return body.split('\n').some((line) => lineKey(line) === key)
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  return String(value).trim() !== ''
}
