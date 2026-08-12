import type Document from '#shared/models/Markdown/Document/mod.ts'

// Dialogue headers as written by message captures: `## 2026-08-08 12:21 - **Jane Doe**`.
// Exactly h2 — quoted/nested h3+ lines are content, not senders.
const AUTHOR_HEADER = /^##(?!#).*?-\s*\*\*(.+?)\*\*\s*$/gm

// A `DM with <name>` from/to entry is the owner's own DM thread, labeled from
// their side — the owner is the implicit counterpart, whatever the name says.
const DM_THREAD = /^dm with /

/**
 * Whether any of `names` appears among a message document's participants:
 * the `from:`/`to:` frontmatter (strings, comma-separated lists, or arrays)
 * or the body's dialogue headers.
 *
 * A message where the notebook owner appears nowhere is an archival capture —
 * a thread saved for reference, not activity. Empty `names` returns true:
 * with no owner identity available, nothing can be classified as archival.
 */
export default function isParticipant(doc: Document, names: string[]): boolean {
  const targets = new Set(names.map(normalize).filter(Boolean))
  if (targets.size === 0) return true

  for (const entry of fromToEntries(doc)) {
    if (DM_THREAD.test(normalize(entry))) return true
    for (const name of entry.split(',')) {
      if (targets.has(normalize(name))) return true
    }
  }

  for (const match of doc.markdown.matchAll(AUTHOR_HEADER)) {
    if (targets.has(normalize(match[1]))) return true
  }

  return false
}

function* fromToEntries(doc: Document): Generator<string> {
  for (const field of ['from', 'to']) {
    const value = doc.yaml[field]
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries) {
      if (typeof entry === 'string') yield entry
    }
  }
}

function normalize(name: string): string {
  return name.trim().toLowerCase()
}
