import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

/** How often a tracking expects entries. `manual` = never swept, logged on demand. */
export type TrackingSchedule = 'daily' | 'weekdays' | 'manual'

/**
 * Where records live: `weekly` = the time-tree shards
 * (time/YYYY/MM/{week}/_tracking/{category}/{slug}.csv, day-letter rows);
 * `yearly` = data/tracking/{year}/{slug}.csv with full-date rows — for sparse
 * metrics that don't belong to the week rhythm.
 */
export type TrackingStorage = 'weekly' | 'yearly'

/** Which capture window prompts for this tracking. `anytime` is never prompted. */
export type TrackingAsk = 'morning' | 'evening' | 'anytime'

/** Value shape of a record column. */
export type TrackingColumnType = 'time' | 'number' | 'duration' | 'range' | 'word' | 'text'

/** How multiple rows on one day collapse to a daily value at query time. */
export type TrackingAggregate = 'last' | 'sum' | 'mean' | 'collect'

/** One column of the record schema (everything after the implicit `date`). */
export interface TrackingColumn {
  name: string
  type: TrackingColumnType
  unit?: string
  aggregate?: TrackingAggregate
}

const DEFAULT_SCHEDULE: TrackingSchedule = 'daily'
const DEFAULT_ASK: TrackingAsk = 'anytime'
const DEFAULT_STORAGE: TrackingStorage = 'weekly'
const COLUMN_TYPES: readonly TrackingColumnType[] = ['time', 'number', 'duration', 'range', 'word', 'text']
const AGGREGATES: readonly TrackingAggregate[] = ['last', 'sum', 'mean', 'collect']

/**
 * TrackingDocument model - defines one tracked metric: the question capture
 * asks, the record schema its CSV rows follow, and how rows aggregate at
 * query time. The why lives in free-form markdown below the YAML.
 *
 * Stored at: $SKY_DIR/tracking/{status}/{slug}.md
 *
 * Status is NOT a YAML field — it's derived from the file path:
 * - /active/   → active
 * - /archived/ → archived (tracking definitions are never deleted, only archived)
 *
 * Records contract: rows live in the weekly tracking shards
 * ($SKY_DIR/time/YYYY/MM/{week}/_tracking/{category}/{slug}.csv), day-letter
 * format, in notebook wall time (no timezone, extended hours valid). Capture
 * appends exactly the row a hand edit would — same file, same shape. The
 * slug is the join key between definition and records — renaming it orphans
 * the record files.
 */
export default class TrackingDocument extends Document {
  static override yamlKeyOrder = [
    'name',
    'title',
    'question',
    'ask',
    'schedule',
    'storage',
    'category',
    'columns',
    'start',
    'end',
    'created',
    'updated',
    'rel',
    'tags',
  ]

  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields

  /** Slug/identifier — the filename, CLI argument, GraphQL name, and CSV basename. */
  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  /** Short human phrasing — how the metric is named in prompts and reports. */
  get title(): string {
    return (this.yaml['title'] as string) ?? this.name
  }

  /** The question capture asks. Absent means this tracking is never prompted. */
  get question(): string | undefined {
    const q = this.yaml['question']
    return typeof q === 'string' && q.trim() ? q.trim() : undefined
  }

  /** Capture window whose ask loop prompts this tracking. */
  get ask(): TrackingAsk {
    const a = this.yaml['ask']
    return a === 'morning' || a === 'evening' ? a : DEFAULT_ASK
  }

  /** Entry cadence. Unknown values normalize to 'daily'. */
  get schedule(): TrackingSchedule {
    const s = this.yaml['schedule']
    return s === 'weekdays' || s === 'manual' ? s : DEFAULT_SCHEDULE
  }

  /** Where records live. Unknown values normalize to 'weekly'. */
  get storage(): TrackingStorage {
    return this.yaml['storage'] === 'yearly' ? 'yearly' : DEFAULT_STORAGE
  }

  /** Informational grouping (health, execution, ...). */
  get category(): string {
    const c = this.yaml['category']
    return typeof c === 'string' ? c : ''
  }

  /**
   * Record schema: the CSV columns after the implicit `date`, in order.
   * Entries without a name are dropped; unknown types normalize to 'text'.
   */
  get columns(): TrackingColumn[] {
    const raw = this.yaml['columns']
    if (!Array.isArray(raw)) return []

    const columns: TrackingColumn[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      const name = typeof record['name'] === 'string' ? record['name'].trim() : ''
      if (!name) continue

      const type = COLUMN_TYPES.includes(record['type'] as TrackingColumnType)
        ? (record['type'] as TrackingColumnType)
        : 'text'
      const unit = typeof record['unit'] === 'string' && record['unit'] ? record['unit'] : undefined
      const aggregate = AGGREGATES.includes(record['aggregate'] as TrackingAggregate)
        ? (record['aggregate'] as TrackingAggregate)
        : undefined

      columns.push({ name, type, ...(unit ? { unit } : {}), ...(aggregate ? { aggregate } : {}) })
    }
    return columns
  }

  /** Basename of this tracking's record files: data/tracking/{year}/{csvBasename}. */
  get csvBasename(): string {
    return `${this.name}.csv`
  }

  /** First tracked day. A tracking with no valid start is prompted nowhere. */
  get start(): PlainDate | undefined {
    return toPlainDate(this.yaml['start'])
  }

  /**
   * Last tracked day, inclusive — like start, it reads the way a human says
   * it. A future value is a PLANNED end; archive() stamps it when unset and
   * keeps it when tracking already stopped earlier.
   */
  get end(): PlainDate | undefined {
    return toPlainDate(this.yaml['end'])
  }

  // Scheduling

  /** Whether the cadence expects an entry on this weekday. `manual` never does. */
  isScheduledOn(day: PlainDate): boolean {
    if (this.schedule === 'manual') return false
    if (this.schedule === 'weekdays') return day.dayOfWeek <= 5
    return true
  }

  /** Whether the tracking existed on this day: started, and not yet past its end. */
  isActiveOn(day: PlainDate): boolean {
    const start = this.start
    if (!start) return false
    if (PlainDate.compare(day, start) < 0) return false

    const end = this.end
    if (end && PlainDate.compare(day, end) > 0) return false

    return true
  }

  /**
   * Whether this day expects an entry: active and scheduled. The single
   * question the ask loop and completeness checks both ask.
   */
  isTrackedOn(day: PlainDate): boolean {
    return this.isActiveOn(day) && this.isScheduledOn(day)
  }

  // Lifecycle

  /**
   * Stamp the end of tracking. The file move to tracking/archived/ is the
   * caller's job — status stays path-derived, like Streak.
   *
   * When a planned end already passed, it stays — the tracking factually
   * ended then. Archiving early (before a planned end) moves the end up to now.
   */
  archive(endAt?: PlainDate): TrackingDocument {
    const stamp = endAt ?? PlainDate.today()
    const existing = this.end
    const end = existing && PlainDate.compare(existing, stamp) <= 0 ? existing : stamp
    return this.updateYaml({ end: end.ymd }).ensureUpdated() as TrackingDocument
  }

  /**
   * Create a new TrackingDocument from input data.
   *
   * YAML key order: name, title, question, ask, schedule, category, columns,
   * start, end, created, updated, rel, tags
   */
  static create(input: {
    name: string
    title?: string
    question?: string
    ask?: TrackingAsk
    schedule?: TrackingSchedule
    storage?: TrackingStorage
    category?: string
    columns?: TrackingColumn[]
    start?: PlainDate
    /** Planned last tracked day, inclusive. */
    end?: PlainDate
    why?: string
    /** Freeform definition sections, kept verbatim below the why. */
    details?: string
    tags?: string | TagSet
    rel?: string[]
    /** YYYY-MM-DD to stamp created/updated with (e.g. notebook time) instead of the system clock */
    createdOn?: string
  }): TrackingDocument {
    const title = input.title ?? input.name
    const start = input.start ?? PlainDate.today()

    const yaml: Record<string, unknown> = {
      name: input.name,
      title,
      question: input.question ?? null,
      ask: input.ask ?? DEFAULT_ASK,
      schedule: input.schedule ?? DEFAULT_SCHEDULE,
      storage: input.storage && input.storage !== DEFAULT_STORAGE ? input.storage : null,
      category: input.category ?? null,
      columns: input.columns && input.columns.length > 0 ? input.columns.map((c) => ({ ...c })) : null,
      start: start.ymd,
      end: input.end ? input.end.ymd : null,
      created: null, // placeholder, filled by ensureCreatedUpdated
      updated: null, // placeholder, filled by ensureCreatedUpdated
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags ? String(input.tags) : null,
    }

    const markdown = TrackingDocument.createTemplate({ title, why: input.why, details: input.details })

    let tracking = new TrackingDocument(yaml, markdown)
    tracking = tracking.ensureCreatedUpdated(input.createdOn) as TrackingDocument

    return tracking
  }

  /** Generate the default markdown body for a new tracking definition. */
  static createTemplate(input: { title: string; why?: string; details?: string }): string {
    const parts = [`# ${input.title}`]
    if (input.why) parts.push(input.why.trim())
    if (input.details) parts.push(input.details.trim())
    return parts.join('\n\n') + '\n'
  }

  /** Load a TrackingDocument from a markdown file. */
  static override fromMarkdown(contentsWithYamlHeader: string): TrackingDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new TrackingDocument(doc.yaml, doc.markdown, doc.yamlError)
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
