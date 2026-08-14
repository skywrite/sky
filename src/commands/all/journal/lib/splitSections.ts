// Pure mechanics of splitting a sectioned journal body into several entries.
// The grouping decisions come from a model (groupSections.ts); everything here
// is deterministic, so the speaker's words never pass through a model on their
// way from one entry to several — sections are cut and reassembled by index.

/** One `## `-section of a pass-1 body, words untouched. */
export type BodySection = {
  heading: string
  /** Verbatim block from after its heading line to before the next heading. */
  body: string
  words: number
}

export type ParsedBody = {
  /** Verbatim text of the whole-recording `## Summary` section, when present. */
  summary?: string
  sections: BodySection[]
}

/** A grouping decision: which sections (0-based) make up one entry. */
export type EntryGroup = {
  title: string
  summary: string
  /** 0-based indexes into ParsedBody.sections, any order; rebuilt in spoken order. */
  sections: number[]
  /** Journal type name (e.g. "Health") when the group fits one; tag-ready. */
  journalType?: string
}

/**
 * Split a sectioned body into its `## ` sections. The `## Summary` section is
 * captured separately — it describes the whole recording and does not belong
 * to any one split entry. Text before the first heading is dropped: pass 1
 * emits none, and the H1 line is rebuilt per entry.
 */
export function parseSectionedBody(markdown: string): ParsedBody {
  const lines = markdown.split('\n')
  const sections: BodySection[] = []
  let summary: string | undefined
  let heading: string | undefined
  let buffer: string[] = []

  const flush = () => {
    if (heading === undefined) return
    const body = buffer.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
    if (/^summary$/i.test(heading)) summary = body
    else sections.push({ heading, body, words: body.split(/\s+/).filter(Boolean).length })
  }

  for (const line of lines) {
    const m = line.match(/^## (.+?)\s*$/)
    if (m) {
      flush()
      heading = m[1]
      buffer = []
    } else if (heading !== undefined) {
      buffer.push(line)
    }
  }
  flush()

  return { summary, sections }
}

/**
 * A grouping is usable only when it is a perfect partition: every section
 * allocated exactly once, nothing invented. Anything else falls back to the
 * unsplit entry — a bad split may never lose or duplicate the speaker's words.
 */
export function validateGroups(groups: EntryGroup[], sectionCount: number): string | undefined {
  if (groups.length === 0) return 'no groups'
  const seen = new Set<number>()
  for (const group of groups) {
    if (group.sections.length === 0) return `empty group: ${group.title}`
    if (!group.title.trim()) return 'a group has no title'
    for (const index of group.sections) {
      if (!Number.isInteger(index) || index < 0 || index >= sectionCount) return `section out of range: ${index}`
      if (seen.has(index)) return `section allocated twice: ${index}`
      seen.add(index)
    }
  }
  if (seen.size !== sectionCount) {
    const missing = Array.from({ length: sectionCount }, (_, i) => i).filter((i) => !seen.has(i))
    return `sections unallocated: ${missing.join(', ')}`
  }
  return undefined
}

/**
 * Rebuild one entry's markdown from its group: shared H1, the entry's own
 * summary, then its sections verbatim, in spoken order regardless of how the
 * group listed them.
 */
export function buildEntryMarkdown(h1: string, group: EntryGroup, sections: BodySection[]): string {
  const parts = [h1, '', '## Summary', group.summary.trim(), '']
  for (const index of [...group.sections].sort((a, b) => a - b)) {
    const section = sections[index]
    parts.push(`## ${section.heading}`, '')
    if (section.body) parts.push(section.body, '')
  }
  return (
    parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
