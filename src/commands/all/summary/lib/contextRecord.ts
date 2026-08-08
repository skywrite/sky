/**
 * The provenance record a summary command appends to its output — a single
 * trailing `<!-- SUMMARY-CONTEXT ... -->` HTML comment holding versioned
 * JSON: what the model read (with token estimates), what was skipped and
 * why, and the budget in force.
 *
 * One format for every summary scope. `scope` discriminates (day, week, ...)
 * and `kind`/`reason` are producer-defined strings the parser never
 * interprets, so new summary types cost no schema change. Consumers:
 * staleness detection (compare `kept` paths against what the period now
 * contains) and missing-input debugging ("why isn't X in the summary"
 * answered from the file itself).
 *
 * The `version` field is for detection, not compatibility (same philosophy
 * as Chat's ContextLog): the reader supports the current version only, and
 * anything else — including the pre-JSON `CONTEXT:` path lists in older
 * summaries — parses to "no record". Any `-->` inside a string value is
 * escaped as `--\u003e` so it cannot terminate the comment early;
 * JSON.parse restores the original text.
 */

export const SUMMARY_CONTEXT_VERSION = 1

export interface SummaryContextDoc {
  /** Notebook-relative path */
  path: string
  /** Estimated tokens of the document as shipped */
  tokens: number
  /** Producer-defined class, e.g. 'journal' | 'action' | 'day' | 'background' */
  kind?: string
}

export interface SummaryContextSkip {
  /** Notebook-relative path */
  path: string
  /** Producer-defined, e.g. 'tiny' | 'yamlError' | 'unreadable' | 'missing' */
  reason: string
}

export interface SummaryContextRecord {
  version: number
  /** What this summary covers: 'day', 'week', ... */
  scope: string
  /** Token budget in force when the summary was generated */
  budget: number
  /** What the model read, in shipped order */
  kept: SummaryContextDoc[]
  /** Inputs left out, with reasons */
  skipped: SummaryContextSkip[]
}

const MARKER = '<!-- SUMMARY-CONTEXT'

export function serializeSummaryContext(record: Omit<SummaryContextRecord, 'version'>): string {
  const fields = [
    `  "version": ${SUMMARY_CONTEXT_VERSION}`,
    `  "scope": ${JSON.stringify(record.scope)}`,
    `  "budget": ${record.budget}`,
    arrayField('kept', record.kept),
    arrayField('skipped', record.skipped),
  ]
  const json = ['{', fields.join(',\n'), '}'].join('\n').replaceAll('-->', '--\\u003e')
  return `\n\n${MARKER}\n${json}\n-->\n`
}

/** Entries one per line — the record stays scannable at dozens of documents. */
function arrayField(name: string, records: object[]): string {
  if (records.length === 0) return `  "${name}": []`
  return `  "${name}": [\n${records.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`
}

/**
 * Split a summary's markdown into the body and the parsed record.
 *
 * A SUMMARY-CONTEXT block is recognized only when it starts at a line start
 * and its JSON parses at the current version — body text that merely quotes
 * the marker stays in the body, and old-style `CONTEXT:` comments or a
 * corrupted block are left in the body untouched with `record: null`.
 */
export function parseSummaryContext(markdown: string): { body: string; record: SummaryContextRecord | null } {
  let from = 0
  let idx: number
  while ((idx = markdown.indexOf(MARKER, from)) !== -1) {
    const atLineStart = idx === 0 || markdown[idx - 1] === '\n'
    if (atLineStart) {
      const match = markdown.slice(idx).match(BLOCK)
      const record = match ? parseRecordJson(match[1]) : null
      if (record) return { body: markdown.slice(0, idx).replace(/\n+$/, '\n'), record }
    }
    from = idx + 1
  }
  return { body: markdown, record: null }
}

// (?:(?!-->)[\s\S])* — comment content that can never cross a `-->`. The
// writer escapes interior `-->`, so the first terminator ends the block; the
// trailing \n* tolerates a normalizer-collapsed final newline.
const BLOCK = /^<!-- SUMMARY-CONTEXT\n((?:(?!-->)[\s\S])*)\n-->\n*$/

function parseRecordJson(text: string): SummaryContextRecord | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed?.version !== SUMMARY_CONTEXT_VERSION) return null
    if (typeof parsed.scope !== 'string' || typeof parsed.budget !== 'number') return null
    if (!Array.isArray(parsed.kept) || !Array.isArray(parsed.skipped)) return null
    for (const k of parsed.kept) {
      if (typeof k?.path !== 'string' || typeof k?.tokens !== 'number') return null
    }
    for (const s of parsed.skipped) {
      if (typeof s?.path !== 'string' || typeof s?.reason !== 'string') return null
    }
    return parsed as SummaryContextRecord
  } catch {
    return null
  }
}
