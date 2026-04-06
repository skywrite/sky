import { parse as parseYAML } from '#shared/yaml/mod.ts'
import * as marked from 'marked'
import { hoursToDurationString } from '#universal/dates/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import ListDocument, { ModficationOptions } from '#shared/models/Markdown/ListDocument/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import durationStringToHours from '#universal/dates/durationStringToHours.ts'

export interface DayConstructorOptions {
  yaml?: string | Record<string, unknown>
  day?: PlainDate
  markdown?: string
}

export interface AddDayItemOptions extends ModficationOptions {
  category?: string // default 'Professional'
}

export interface AddCompleteItemOptions extends AddDayItemOptions {
  time: string // prepends "HH:MM > " to the item
}

/** A reference to a document linked from a Complete item */
export interface DocumentRef {
  time: string // HH:MM format
  path: string // relative path from day directory
  title: string // link text
}

/** A reference to a Complete item with its parsed components */
export interface CompleteItemRef {
  key: string // "17:08 > Kevin to #mna-atlas-closing-integration Slack"
  link: string // "[summary](actions/messages/slack_Kevin....md)"
  path: string // "actions/messages/slack_Kevin....md"
  title: string // "summary text"
  raw: string // full item string
}

export default class DayDocument extends ListDocument {
  private _day: PlainDate
  private _ymd = ''

  /** Preferred key order for day document YAML frontmatter */
  static override yamlKeyOrder = ['started', 'ended', 'location', 'tz']

  constructor({ yaml, day, markdown }: DayConstructorOptions) {
    if (day && !markdown) {
      const ymd = day.ymd
      const dayWordShort = day.dayShort
      markdown = `\n# **${ymd} - ${dayWordShort}**\n`
    } else if (!day && markdown) {
      day = extractDayFromMarkdown(markdown) ?? PlainDate.today()
    } else if (!day && !markdown) {
      day = PlainDate.today()
      const ymd = day.ymd
      const dayWordShort = day.dayShort
      markdown = `\n# **${ymd} - ${dayWordShort}**\n`
    }

    let yamlObj: Record<string, unknown> = {}
    if (typeof yaml === 'string') {
      yamlObj = (parseYAML(yaml) || {}) as Record<string, unknown>
    } else if (typeof yaml === 'object') {
      yamlObj = yaml || {}
    } else {
      yamlObj = {}
    }

    super(yamlObj, markdown)

    this._day = day as PlainDate
  }

  get day(): PlainDate {
    return this._day
  }

  get dayWordShort(): string {
    return this._day.dayShort
  }

  /**
   * A day is "perfect" when all planned tasks were executed:
   * - No incomplete items in any Commitments list
   * - No incomplete items in any Todos list
   * - Reminders list is empty or all items done
   * - No "Incomplete" section exists
   */
  get perfect(): boolean {
    for (const list of this.lists) {
      const title = list.title

      // No "Incomplete" section should exist
      if (title.includes('Incomplete')) {
        return false
      }

      // Check Commitments and Todos lists for incomplete items
      if (title.includes('Commitments') || title.includes('Todos')) {
        const hasIncompleteItems = list.items.some(DayDocument.isItemNotDone)
        if (hasIncompleteItems) {
          return false
        }
      }

      // Check Reminders list
      if (title === 'Reminders') {
        const hasIncompleteItems = list.items.some(DayDocument.isItemNotDone)
        if (hasIncompleteItems) {
          return false
        }
      }
    }

    return true
  }

  get ended(): ZonedDateTime | undefined {
    const ended = this.yaml['ended'] as undefined | string
    if (!ended) return undefined

    if (!this.started) return undefined

    const hours = durationStringToHours(ended)
    // Add hours to started time, then normalize for display
    return this.started.addHours(hours).normalize()
  }

  get started(): ZonedDateTime | undefined {
    const started = this.yaml['started'] as undefined | string
    if (!started) return undefined

    return new ZonedDateTime(new PlainDateTime(started, this.YMD), this.timezone)
  }

  get timezone(): string {
    const tzIANA = this.yaml['tz'] as string | undefined
    return tzIANA || 'America/Chicago'
  }

  get location(): string | undefined {
    return this.yaml['location'] as string | undefined
  }

  setLocation(placePath: string): DayDocument {
    return this.updateYaml({ location: placePath })
  }

  get YMD(): string {
    return this.day.ymd
  }

  /**
   * Extract meeting references from Complete sections.
   * Matches items like: `12:00 > ... -> [Title](actions/meetings/file.md)`
   */
  get meetingRefs(): DocumentRef[] {
    return this.extractDocumentRefs('actions/meetings/')
  }

  /**
   * Extract message references from Complete sections.
   * Matches items like: `10:20 > ... -> [Title](actions/messages/file.md)`
   */
  get messageRefs(): DocumentRef[] {
    return this.extractDocumentRefs('actions/messages/')
  }

  /**
   * Extract note references from Complete sections.
   * Matches items like: `09:00 > ... -> [Title](actions/notes/file.md)`
   */
  get noteRefs(): DocumentRef[] {
    return this.extractDocumentRefs('actions/notes/')
  }

  /**
   * Extract project references from Complete sections.
   * Matches items like: `09:52 > projects/Notebook-V1 -> description`
   * Note: Projects use inline text format, not markdown links.
   */
  get projectRefs(): DocumentRef[] {
    const refs: DocumentRef[] = []

    // Pattern: HH:MM > projects/ProjectName -> description
    const pattern = /^(\d{2}:\d{2}) > (projects\/[^\s]+) -> (.+)$/

    for (const list of this.lists) {
      if (!list.title.endsWith('Complete')) continue

      for (const item of list.items) {
        const match = item.match(pattern)
        if (match) {
          refs.push({
            time: match[1],
            path: match[2],
            title: match[3],
          })
        }
      }
    }

    return refs
  }

  /**
   * Extract decision references from Complete sections.
   * Matches items like: `05:25 > decisions/Decision-Name -> Status | Description`
   * Note: Decisions use inline text format, not markdown links.
   */
  get decisionRefs(): DocumentRef[] {
    const refs: DocumentRef[] = []

    // Pattern: HH:MM > decisions/DecisionName -> description
    const pattern = /^(\d{2}:\d{2}) > (decisions\/[^\s]+) -> (.+)$/

    for (const list of this.lists) {
      if (!list.title.endsWith('Complete')) continue

      for (const item of list.items) {
        const match = item.match(pattern)
        if (match) {
          refs.push({
            time: match[1],
            path: match[2],
            title: match[3],
          })
        }
      }
    }

    return refs
  }

  /**
   * Extract all document references from Complete sections (meetings, messages, notes, projects, decisions).
   *
   * TODO: Consider adding more ref types: videos, goals, journal entries, etc.
   */
  get allDocumentRefs(): DocumentRef[] {
    return [...this.meetingRefs, ...this.messageRefs, ...this.noteRefs, ...this.projectRefs, ...this.decisionRefs]
  }

  private extractDocumentRefs(pathPattern: string): DocumentRef[] {
    const refs: DocumentRef[] = []

    // Pattern to match: HH:MM > ... [title](path)
    const timePattern = /^(\d{2}:\d{2}) >/
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g

    for (const list of this.lists) {
      if (!list.title.endsWith('Complete')) continue

      for (const item of list.items) {
        const timeMatch = item.match(timePattern)
        if (!timeMatch) continue

        const time = timeMatch[1]

        // Find all markdown links in the item
        let match: RegExpExecArray | null
        while ((match = linkPattern.exec(item)) !== null) {
          const title = match[1]
          const path = match[2]

          if (path.includes(pathPattern)) {
            refs.push({ time, path, title })
          }
        }
      }
    }

    return refs
  }

  public override addItem(listTitle: string, item: string, opts?: ModficationOptions): this {
    let sort = false
    if (listTitle.endsWith('Complete') || listTitle.endsWith('Commitments')) {
      sort = true
    }

    const newOpts = { ...opts, sort }

    return super.addItem(listTitle, item, newOpts) as this
  }

  /**
   * Add an item to the Most Important list, creating the list at the top if it doesn't exist.
   * Order: Most Important → Commitments → Todos → Reminders → Complete
   */
  public addMostImportantItem(item: string, opts?: ModficationOptions): this {
    const listName = 'Most Important'
    if (this.lists.find((l) => l.title === listName)) {
      return this.addItem(listName, item, opts)
    }

    // List doesn't exist, create it at the top
    return this.insertList(0, new ItemList(listName)).addItem(listName, item, opts)
  }

  /**
   * Add an item to a Commitments list, creating the list if it doesn't exist.
   * Order: Most Important → Commitments → Todos → Reminders → Complete
   */
  public addCommitmentItem(item: string, opts?: AddDayItemOptions): this {
    const category = opts?.category ?? 'Professional'
    const listName = `${category} Commitments`
    if (this.lists.find((l) => l.title === listName)) {
      return this.addItem(listName, item, opts)
    }

    // List doesn't exist, create it after Most Important or at beginning
    const mostImportantIndex = this.findListIndex((l) => l.title === 'Most Important')
    const insertIndex = mostImportantIndex !== -1 ? mostImportantIndex + 1 : 0

    return this.insertList(insertIndex, new ItemList(listName)).addItem(listName, item, opts)
  }

  /**
   * Add an item to a Todos list, creating the list if it doesn't exist.
   * Order: Most Important → Commitments → Todos → Reminders → Complete
   */
  public addTodoItem(item: string, opts?: AddDayItemOptions): this {
    const category = opts?.category ?? 'Professional'
    const listName = `${category} Todos`
    if (this.lists.find((l) => l.title === listName)) {
      return this.addItem(listName, item, opts)
    }

    // List doesn't exist, create it after last Commitments, or after Most Important, or at beginning
    const lastCommitmentsIndex = this.findLastListIndex((l) => l.title.endsWith('Commitments'))
    const mostImportantIndex = this.findListIndex((l) => l.title === 'Most Important')

    let insertIndex: number
    if (lastCommitmentsIndex !== -1) {
      insertIndex = lastCommitmentsIndex + 1
    } else if (mostImportantIndex !== -1) {
      insertIndex = mostImportantIndex + 1
    } else {
      insertIndex = 0
    }

    return this.insertList(insertIndex, new ItemList(listName)).addItem(listName, item, opts)
  }

  /**
   * Add an item to the Reminders list, creating the list if it doesn't exist.
   * Order: Most Important → Commitments → Todos → Reminders → Complete
   */
  public addReminderItem(item: string, opts?: AddDayItemOptions): this {
    const listName = 'Reminders'
    if (this.lists.find((l) => l.title === listName)) {
      return this.addItem(listName, item, opts)
    }

    // List doesn't exist, create it after last Todos, or after last Commitments, or before first Complete, or at end
    const lastTodosIndex = this.findLastListIndex((l) => l.title.endsWith('Todos'))
    const lastCommitmentsIndex = this.findLastListIndex((l) => l.title.endsWith('Commitments'))
    const firstCompleteIndex = this.findListIndex((l) => l.title.endsWith('Complete'))

    let insertIndex: number
    if (lastTodosIndex !== -1) {
      insertIndex = lastTodosIndex + 1
    } else if (lastCommitmentsIndex !== -1) {
      insertIndex = lastCommitmentsIndex + 1
    } else if (firstCompleteIndex !== -1) {
      insertIndex = firstCompleteIndex
    } else {
      insertIndex = this.lists.length
    }

    return this.insertList(insertIndex, new ItemList(listName)).addItem(listName, item, opts)
  }

  /**
   * Add an item to a Complete list, creating the list if it doesn't exist.
   * Order: Most Important → Commitments → Todos → Reminders → Complete
   */
  public addCompleteItem(item: string, opts: AddCompleteItemOptions): this {
    const category = opts.category ?? 'Professional'
    const listName = `${category} Complete`
    const finalItem = `${opts.time} > ${item}`

    if (this.lists.find((l) => l.title === listName)) {
      return this.addItem(listName, finalItem, opts)
    }

    // List doesn't exist, create it after Reminders, or after last Todos, or at end
    const remindersIndex = this.findListIndex((l) => l.title === 'Reminders')
    const lastTodosIndex = this.findLastListIndex((l) => l.title.endsWith('Todos'))

    let insertIndex: number
    if (remindersIndex !== -1) {
      insertIndex = remindersIndex + 1
    } else if (lastTodosIndex !== -1) {
      insertIndex = lastTodosIndex + 1
    } else {
      insertIndex = this.lists.length
    }

    return this.insertList(insertIndex, new ItemList(listName)).addItem(listName, finalItem, opts)
  }

  /**
   * Get an existing Complete item by key prefix.
   * Returns structured object with parsed path, or undefined if not found.
   *
   * @param keyPrefix - The key to match (everything before " -> "), e.g., "17:08 > Kevin Slack"
   * @param category - Optional category to limit search (e.g., "Professional"). If not provided, searches all Complete lists.
   */
  public getCompleteItem(keyPrefix: string, category?: string): CompleteItemRef | undefined {
    // Pattern to match: key -> [title](path)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/

    for (const list of this.lists) {
      if (!list.title.endsWith('Complete')) continue
      if (category && list.title !== `${category} Complete`) continue

      for (const item of list.items) {
        // Check if item starts with the key prefix followed by " -> "
        if (!item.startsWith(keyPrefix + ' -> ')) continue

        const match = item.match(linkPattern)
        if (match) {
          const title = match[1]
          const path = match[2]
          const link = match[0]

          return {
            key: keyPrefix,
            link,
            path,
            title,
            raw: item,
          }
        }
      }
    }

    return undefined
  }

  /**
   * Set a Complete item by key prefix.
   * Replaces if exists, adds if not.
   *
   * @param keyPrefix - The key to match (everything before " -> "), e.g., "17:08 > Kevin Slack"
   * @param value - The value part (after " -> "), e.g., "[summary](path)"
   * @param opts - Options including time and category
   */
  public setCompleteItem(keyPrefix: string, value: string, opts: AddCompleteItemOptions): this {
    const category = opts.category ?? 'Professional'
    const listName = `${category} Complete`
    const newItem = `${keyPrefix} -> ${value}`

    // Find existing item
    const existing = this.getCompleteItem(keyPrefix, category)

    if (existing) {
      // Find the list and item index to replace
      const listIndex = this.findListIndex((l) => l.title === listName)
      if (listIndex === -1) {
        // Shouldn't happen if getCompleteItem found something, but handle it
        return this.addCompleteItem(`${keyPrefix.substring(opts.time.length + 3)} -> ${value}`, opts)
      }

      const list = this.lists[listIndex]
      const itemIndex = list.items.findIndex((item) => item === existing.raw)

      if (itemIndex === -1) {
        // Item not found in list (shouldn't happen), just add it
        return this.addItem(listName, newItem, { sort: true })
      }

      // Remove old item and add new one (will be sorted into correct position)
      return this.removeItem(listName, itemIndex).addItem(listName, newItem, { sort: true })
    }

    // No existing item, add new one
    // Extract the item content (without the key prefix part that includes time)
    // keyPrefix is like "17:08 > Kevin Slack", we need "Kevin Slack -> [summary](path)"
    const itemContent = `${keyPrefix.substring(opts.time.length + 3)} -> ${value}`
    return this.addCompleteItem(itemContent, opts)
  }

  public removeEmptyLists(): DayDocument {
    // deno-lint-ignore no-this-alias
    let doc: DayDocument = this
    let emptyIndex: number
    while ((emptyIndex = doc.findListIndex((l) => l.size === 0)) !== -1) {
      doc = doc.removeList(emptyIndex) as DayDocument
    }
    return doc
  }

  public setEnded(when?: PlainDateTime | ZonedDateTime): DayDocument {
    // can't actually set the end without the start
    if (!this.started) return this.clone()

    // Convert to ZonedDateTime for proper timezone-aware calculation
    let endZoned: ZonedDateTime
    if (when instanceof ZonedDateTime) {
      endZoned = when
    } else if (when instanceof PlainDateTime) {
      // Wrap PlainDateTime with the day's timezone
      endZoned = new ZonedDateTime(when, this.timezone)
    } else {
      // Default to now in the day's timezone
      endZoned = ZonedDateTime.now(this.timezone)
    }

    // Use the new timezone-aware duration calculation
    const diffHours = this.started.hoursBetween(endZoned)

    return this.updateYaml({ ended: hoursToDurationString(diffHours) })
  }

  public setStarted(when?: PlainDateTime | ZonedDateTime): DayDocument {
    // Accept either PlainDateTime or ZonedDateTime
    let startedDt: PlainDateTime
    if (when instanceof ZonedDateTime) {
      startedDt = when.plainDateTime
    } else {
      startedDt = when || new PlainDateTime()
    }
    return this.updateYaml({ started: startedDt.time })
  }

  public setTimezone(tzIANA: string): DayDocument {
    return this.updateYaml({ tz: tzIANA })
  }

  public override toString(): string {
    return `DayDocument<${this.YMD}>`
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): DayDocument {
    const { yaml, markdown } = splitYamlMarkdown(contentsWithOptionalYamlHeader)
    return new DayDocument({ yaml, markdown })
  }

  static createPastDay(day: PlainDate, yaml?: string): DayDocument {
    return new DayDocument({ yaml, day }).addList('Professional Complete').addList('Personal Complete')
  }

  static createFutureDay(day: PlainDate, yaml?: string): DayDocument {
    return new DayDocument({ yaml, day })
      .addList('Professional Commitments')
      .addList('Personal Commitments')
      .addList('Professional Todos')
      .addList('Personal Todos')
      .addList('Reminders')
      .addList('Professional Complete')
      .addList('Personal Complete')
  }

  static isItemDone(task: string): boolean {
    // simple strikethrough tasks: ~~task~~
    const simplePattern = /^~~[^~]+~~$/

    // tasks with time: HH:MM > ~~path -> task~~
    const timePattern = /^\d{2}:\d{2} > ~~[^~]+~~$/

    return simplePattern.test(task) || timePattern.test(task)
  }

  static isItemNotDone(task: string): boolean {
    return !DayDocument.isItemDone(task)
  }

  static itemStartsWithTime(task: string): boolean {
    const timePattern = /^\d{2}:\d{2} >/
    return timePattern.test(task)
  }

  static itemDoesNotStartWithTime(task: string): boolean {
    return !DayDocument.itemStartsWithTime(task)
  }
}

/** Extract PlainDate from markdown heading like "# **2026-01-23 - Thu**" */
function extractDayFromMarkdown(markdown: string): PlainDate | undefined {
  const tokens = marked.lexer(markdown, {})

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 1) {
      // Extract YMD pattern from heading text
      const ymdMatch = token.text.match(/(\d{4}-\d{2}-\d{2})/)
      if (ymdMatch) {
        return PlainDate.from(ymdMatch[1])
      }
    }
  }

  return undefined
}
