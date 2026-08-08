import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import PlainDateTime from '#universal/dates/nbdt/PlainDateTime/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'

/**
 * DecisionDocument model - represents a decision with minimal queryable metadata in YAML
 * and free-form narrative in markdown.
 *
 * Stored at: $SKY_DIR/decisions/{year}/{pending|resolved|archived}/{month}/{name}.md
 */
export default class DecisionDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    // Normalize tags to string format if they're an array or other format
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields

  /**
   * Slug/identifier for easy reference
   */
  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  /**
   * Human-readable summary (matches the H1 title)
   */
  get summary(): string {
    return (this.yaml['summary'] as string) ?? ''
  }

  /**
   * Target date/time for when the decision should be made.
   * Returns PlainDateTime if time is specified, PlainDate if date only.
   * Format in YAML: "2026-01-26" (date) or "2026-01-26 15:00" (datetime)
   */
  get target(): PlainDate | PlainDateTime | undefined {
    const value = this.yaml['target']
    if (!value || typeof value !== 'string') return undefined

    // Check if time is included (YYYY-MM-DD HH:MM format)
    if (value.includes(' ')) {
      try {
        return new PlainDateTime(value)
      } catch {
        return undefined
      }
    }

    // Date only (YYYY-MM-DD format)
    try {
      return new PlainDate(value)
    } catch {
      return undefined
    }
  }

  /**
   * When the decision was identified as needed
   */
  get identified(): ZonedDateTime | undefined {
    const value = this.yaml['identified']
    if (!value) return undefined
    return DecisionDocument.parseZonedDateTime(value)
  }

  /**
   * When the decision was made (null if pending)
   */
  get resolved(): ZonedDateTime | undefined {
    const value = this.yaml['resolved']
    if (!value) return undefined
    return DecisionDocument.parseZonedDateTime(value)
  }

  /**
   * Whether this decision is still pending (no resolved date)
   */
  get isPending(): boolean {
    return !this.resolved
  }

  /**
   * Parse a ZonedDateTime from YAML value
   * Supports formats like:
   * - "2026-01-15T10:30:00-06:00[America/Chicago]" (T separator)
   * - "2026-01-15 10:30-06:00[America/Chicago]" (space separator)
   */
  private static parseZonedDateTime(value: unknown): ZonedDateTime | undefined {
    if (value instanceof ZonedDateTime) return value
    if (typeof value !== 'string') return undefined

    // Parse format with timezone in brackets: "2026-01-15T10:30:00-06:00[America/Chicago]"
    const match = value.match(/^(.+)\[([^\]]+)\]$/)
    if (match) {
      const [, isoWithOffset, timezone] = match
      // Extract date and time from ISO string (ignore offset, use timezone)
      // Supports both T and space separator: "2026-01-15T10:30" or "2026-01-15 10:30"
      const dateTimeMatch = isoWithOffset.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
      if (dateTimeMatch) {
        const [, date, time] = dateTimeMatch
        return new ZonedDateTime({ date, time, timezone })
      }
    }

    // Fallback: try parsing as simple datetime string
    try {
      return new ZonedDateTime(value)
    } catch {
      return undefined
    }
  }

  /**
   * Format a ZonedDateTime for YAML storage
   * Returns format: "2026-01-15T10:30:00-06:00[America/Chicago]"
   */
  static formatZonedDateTime(zdt: ZonedDateTime): string {
    return `${zdt.toISOString()}[${zdt.timezone}]`
  }

  /**
   * Create a new DecisionDocument from input data
   */
  /**
   * Format a target date for YAML storage
   * Returns "YYYY-MM-DD" for PlainDate or "YYYY-MM-DD HH:MM" for PlainDateTime
   */
  static formatTargetDate(target: PlainDate | PlainDateTime | string): string {
    if (typeof target === 'string') return target
    if (target instanceof PlainDateTime) {
      return `${target.date} ${target.time}`
    }
    return target.ymd
  }

  static create(input: {
    name: string
    summary?: string
    identified?: ZonedDateTime
    target?: PlainDate | PlainDateTime | string
    title?: string
    context?: string
    desiredOutcomes?: string
    tags?: string | TagSet
    rel?: string[]
  }): DecisionDocument {
    const now = new ZonedDateTime()
    const identified = input.identified ?? now

    // Build yaml with explicit field order
    const yaml: Record<string, unknown> = {
      name: input.name,
      summary: input.summary ?? input.title ?? input.name,
      identified: DecisionDocument.formatZonedDateTime(identified),
      target: input.target ? DecisionDocument.formatTargetDate(input.target) : null,
      resolved: null,
      created: null, // placeholder, filled by ensureCreatedUpdated
      updated: null, // placeholder, filled by ensureCreatedUpdated
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags ? String(input.tags) : null,
    }

    const markdown = DecisionDocument.createTemplate({
      title: input.title ?? input.name,
      context: input.context,
      desiredOutcomes: input.desiredOutcomes,
    })

    let decision = new DecisionDocument(yaml, markdown)

    // created/updated follow the identified date so the stamps stay on
    // notebook time rather than whatever the system clock says right now
    decision = decision.ensureCreatedUpdated(identified.date) as DecisionDocument

    return decision
  }

  /**
   * Generate a default markdown template for a new decision
   */
  static createTemplate(input: {
    title?: string
    context?: string
    desiredOutcomes?: string
    decision?: string
    outcome?: string
  }): string {
    const title = input.title ?? 'Decision'
    const context = input.context ?? ''
    const desiredOutcomes = input.desiredOutcomes ?? ''
    const decision = input.decision ?? ''
    const outcome = input.outcome ?? ''

    let markdown = `
# ${title}

${context}
`

    if (desiredOutcomes) {
      markdown += `
## Desired Outcomes

${desiredOutcomes}
`
    }

    markdown += `
## Decision

${decision}

## Outcome

${outcome}
`
    return markdown.trim()
  }

  /**
   * Mark this decision as resolved with current time
   */
  resolve(resolvedAt?: ZonedDateTime): DecisionDocument {
    const resolved = resolvedAt ?? new ZonedDateTime()
    const doc = this.clone()
    doc._yaml['resolved'] = DecisionDocument.formatZonedDateTime(resolved)
    return doc.ensureUpdated() as DecisionDocument
  }

  /**
   * Load a DecisionDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): DecisionDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new DecisionDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
