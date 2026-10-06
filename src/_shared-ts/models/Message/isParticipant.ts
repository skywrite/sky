import type Document from '#shared/models/Markdown/Document/mod.ts'
import { parseSlackConversation } from './slack/parse.ts'

// Other message media retain their existing H2 dialogue convention.
const AUTHOR_HEADER = /^##(?!#).*?-\s*\*\*(.+?)\*\*\s*$/gm

// A `DM with <name>` from/to entry is the owner's own DM thread, labeled from
// their side — the owner is the implicit counterpart, whatever the name says.
const DM_THREAD = /^dm with /

/**
 * Whether the owner appears among a message document's participants: the
 * `from:`/`to:`/`cc:` frontmatter (strings, comma-separated lists, or arrays)
 * or the body's dialogue headers. `names` are the owner's names. `addresses`
 * are their email addresses, which an email capture writes in place of a
 * name when the sender's mail gave none.
 *
 * A message where the notebook owner appears nowhere is an archival capture —
 * a thread saved for reference, not activity. Empty `names` returns true:
 * with no owner identity available, nothing can be classified as archival.
 * Addresses alone are not an identity; a Slack thread never carries one.
 */
export default function isParticipant(doc: Document, names: string[], addresses: string[] = []): boolean {
  const targets = new Set(names.map(normalize).filter(Boolean))
  if (targets.size === 0) return true
  for (const address of addresses) targets.add(normalize(address))

  for (const entry of addressedEntries(doc)) {
    if (DM_THREAD.test(normalize(entry))) return true
    for (const name of entry.split(',')) {
      if (targets.has(normalize(name))) return true
    }
  }

  const authors =
    doc.yaml.medium === 'Slack'
      ? parseSlackConversation(doc.markdown).messages.map((message) => message.author)
      : [...doc.markdown.matchAll(AUTHOR_HEADER)].map((match) => match[1])
  for (const author of authors) {
    if (targets.has(normalize(author))) return true
  }

  return false
}

function* addressedEntries(doc: Document): Generator<string> {
  for (const field of ['from', 'to', 'cc']) {
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
