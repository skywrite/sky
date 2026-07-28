import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

/** How often a streak expects completion. */
export type StreakSchedule = 'daily' | 'weekdays'

const DEFAULT_SCHEDULE: StreakSchedule = 'daily'

/** Title of the day-file list that carries streak items. */
export const STREAKS_LIST_TITLE = 'Streaks'

/**
 * StreakDocument model - a habit-tracking rule with minimal queryable metadata
 * in YAML and free-form narrative (the why + detailed rules) in markdown.
 *
 * Stored at: $SKY_DIR/streaks/{status}/{slug}.md
 *
 * Status is NOT a YAML field — it's derived from the file path:
 * - /active/   → active
 * - /archived/ → archived (streaks are never deleted, only archived)
 *
 * Day-file contract: each tracked day carries this streak's `title` as a plain
 * bullet in the day's `## Streaks` list, optionally decorated with a run count
 * (`Eat clean — 12d`). Completion is the standard strikethrough mechanic
 * (`~~Eat clean — 12d~~`, see DayDocument.isItemDone). The title is therefore
 * the join key between day items and this rule — renaming it orphans history.
 */
export default class StreakDocument extends Document {
  static override yamlKeyOrder = ['name', 'title', 'schedule', 'start', 'end', 'created', 'updated', 'rel', 'tags']

  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields

  /** Slug/identifier — the filename, CLI argument, and GraphQL name. */
  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  /** Short human phrasing — what actually appears in the day file's Streaks list. */
  get title(): string {
    return (this.yaml['title'] as string) ?? this.name
  }

  /** Completion cadence. Unknown values normalize to 'daily'. */
  get schedule(): StreakSchedule {
    return this.yaml['schedule'] === 'weekdays' ? 'weekdays' : DEFAULT_SCHEDULE
  }

  /** First tracked day. A streak with no valid start is tracked nowhere. */
  get start(): PlainDate | undefined {
    return toPlainDate(this.yaml['start'])
  }

  /**
   * Last tracked day, inclusive — like start, it reads the way a human says
   * it. A future value is a PLANNED end ("30 days", "through Dec 31");
   * archive() stamps it when unset and keeps it when tracking already
   * stopped earlier.
   */
  get end(): PlainDate | undefined {
    return toPlainDate(this.yaml['end'])
  }

  // Scheduling

  /** Whether the cadence expects completion on this weekday. */
  isScheduledOn(day: PlainDate): boolean {
    if (this.schedule === 'weekdays') return day.dayOfWeek <= 5
    return true
  }

  /** Whether the streak existed on this day: started, and not yet past its end. */
  isActiveOn(day: PlainDate): boolean {
    const start = this.start
    if (!start) return false
    if (PlainDate.compare(day, start) < 0) return false

    const end = this.end
    if (end && PlainDate.compare(day, end) > 0) return false

    return true
  }

  /**
   * Whether this day's file should carry (and count) this streak's item:
   * active and scheduled. The single question both the day-file stamper and
   * the run computation ask.
   */
  isTrackedOn(day: PlainDate): boolean {
    return this.isActiveOn(day) && this.isScheduledOn(day)
  }

  // Day-item text

  /** Render the day-list item text: `Eat clean` or `Eat clean — 12d`. */
  static formatDayItem(title: string, count?: number): string {
    return count === undefined ? title : `${title} — ${count}d`
  }

  /**
   * Recover the bare title from a day-list item: strips the strikethrough
   * wrapper and the trailing ` — Nd` decoration. Splits on the LAST dash-count
   * suffix, so titles containing em-dashes survive.
   */
  static parseDayItemTitle(item: string): string {
    let text = item.trim()
    const struck = text.match(/^~~(.*)~~$/)
    if (struck) text = struck[1]
    return text.replace(/\s+—\s+\d+d$/, '').trim()
  }

  /** Whether a day-list item (struck or not) belongs to this streak. */
  matchesDayItem(item: string): boolean {
    return StreakDocument.parseDayItemTitle(item) === this.title
  }

  // Lifecycle

  /**
   * Stamp the end of tracking. The file move to streaks/archived/ is the
   * caller's job — status stays path-derived, like Idea.
   *
   * When a planned end already passed, it stays — the streak factually ended
   * then. Archiving early (before a planned end) moves the end up to now.
   */
  archive(endAt?: PlainDate): StreakDocument {
    const stamp = endAt ?? PlainDate.today()
    const existing = this.end
    const end = existing && PlainDate.compare(existing, stamp) <= 0 ? existing : stamp
    return this.updateYaml({ end: end.ymd }).ensureUpdated() as StreakDocument
  }

  /**
   * Create a new StreakDocument from input data.
   *
   * YAML key order: name, title, schedule, start, end, created, updated, rel, tags
   */
  static create(input: {
    name: string
    title?: string
    schedule?: StreakSchedule
    start?: PlainDate
    /** Planned last tracked day, inclusive. */
    end?: PlainDate
    why?: string
    /** Freeform definition sections, kept verbatim below the why. */
    details?: string
    tags?: string | TagSet
    rel?: string[]
  }): StreakDocument {
    const title = input.title ?? input.name
    const start = input.start ?? PlainDate.today()

    const yaml: Record<string, unknown> = {
      name: input.name,
      title,
      schedule: input.schedule ?? DEFAULT_SCHEDULE,
      start: start.ymd,
      end: input.end ? input.end.ymd : null,
      created: null, // placeholder, filled by ensureCreatedUpdated
      updated: null, // placeholder, filled by ensureCreatedUpdated
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags ? String(input.tags) : null,
    }

    const markdown = StreakDocument.createTemplate({ title, why: input.why, details: input.details })

    let streak = new StreakDocument(yaml, markdown)
    streak = streak.ensureCreatedUpdated() as StreakDocument

    return streak
  }

  /** Generate the default markdown body for a new streak. */
  static createTemplate(input: { title: string; why?: string; details?: string }): string {
    const parts = [`# ${input.title}`]
    if (input.why) parts.push(input.why.trim())
    if (input.details) parts.push(input.details.trim())
    return parts.join('\n\n') + '\n'
  }

  /** Load a StreakDocument from a markdown file. */
  static override fromMarkdown(contentsWithYamlHeader: string): StreakDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new StreakDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}

/** Coerce a YAML value (string, Date, PlainDate) to a PlainDate, or undefined. */
function toPlainDate(value: unknown): PlainDate | undefined {
  if (value instanceof PlainDate) return value
  if (value instanceof Date) return new PlainDate(value)
  if (typeof value === 'string' && value.trim()) {
    try {
      return new PlainDate(value.trim())
    } catch {
      return undefined
    }
  }
  return undefined
}
