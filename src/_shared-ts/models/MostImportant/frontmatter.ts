import { stringify } from '#shared/yaml/mod.ts'

/**
 * The MI document's frontmatter — shared by the question template and the AI
 * synthesis path so both write the identical shape. Serialized with the YAML
 * stringifier so a summary containing a colon (the sharp-MI "Decide: …"
 * shape), quotes, or a hash always round-trips instead of silently corrupting
 * the frontmatter. An empty summary renders as a bare `summary:` key, same as
 * the other empty keys.
 */
export function miFrontmatter(summary: string): string {
  return [
    '---',
    stringify({ summary: summary || null, complete: null, dateStarted: null, rel: null, tags: null }),
    '---',
  ].join('\n')
}

/** Collapse an MI statement to one line: it becomes YAML `summary:` and a
 * day-file link label, so newlines have nowhere legal to live. */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
