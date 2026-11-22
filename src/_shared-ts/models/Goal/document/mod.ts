import Document from '#shared/models/Markdown/Document/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

/** One goal inside an older whole-category file */
export interface Goal {
  /** Goal area (e.g., "Health", "Relationships") */
  area: string
  /** The desired outcome */
  outcome: string
  /** Current state description */
  currentState: string
  /** Why this goal matters */
  whyItMatters: string
}

export type GoalCategory = 'Personal' | 'Professional'

/**
 * GoalDocument model - one goal: what the person is going after, and why.
 *
 * Stored at: $SKY_DIR/goals/active/{name}.md while pursued, then
 * $SKY_DIR/goals/archived/{year}/{name}.md once reached or dropped. Status and
 * name come from the path (see ../paths.ts), never from a field in the file.
 *
 * Older notebooks keep every goal of a category in one file
 * ($SKY_DIR/goals/personal.md, professional.md). Those still load, and `goals`
 * reads the areas written inside them. See ../docs/README.md.
 */
export default class GoalDocument extends Document {
  static override yamlKeyOrder = ['title', 'category', 'created', 'updated', 'rel', 'tags']

  private _goals: Goal[] | null = null
  private _discoveryNotes: string | null = null

  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    super(yaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields

  /**
   * Category: "Personal" or "Professional"
   */
  get category(): GoalCategory {
    return this.yaml['category'] === 'Professional' ? 'Professional' : 'Personal'
  }

  /**
   * The goal in a few words: the `title` field, else the first heading.
   */
  get title(): string {
    const title = this.yaml['title']
    if (typeof title === 'string' && title.trim()) return title.trim()
    const heading = this.markdown.match(/^#\s+(.+)$/m)
    return heading ? heading[1].trim() : `${this.category} Goals`
  }

  /**
   * The areas written inside an older whole-category file. A one-goal file
   * has none. Cached after first parse.
   */
  get goals(): Goal[] {
    if (this._goals === null) {
      this.parseGoalsFromMarkdown()
    }
    return this._goals!
  }

  /**
   * Discovery notes section (AI conversation excerpts)
   */
  get discoveryNotes(): string | undefined {
    if (this._goals === null) {
      this.parseGoalsFromMarkdown()
    }
    return this._discoveryNotes ?? undefined
  }

  /**
   * Whether an older whole-category file has any areas written in it
   */
  get hasGoals(): boolean {
    return this.goals.length > 0
  }

  /**
   * Get goals filtered by area
   */
  getByArea(area: string): Goal[] {
    return this.goals.filter((g) => g.area.toLowerCase() === area.toLowerCase())
  }

  /**
   * Get all unique goal areas
   */
  get areas(): string[] {
    return [...new Set(this.goals.map((g) => g.area))]
  }

  /**
   * Parse goals from the markdown body.
   * Format expected:
   * ## [Area]
   * **Outcome:** ...
   * **Current State:** ...
   * **Why It Matters:** ...
   */
  private parseGoalsFromMarkdown(): void {
    const goals: Goal[] = []
    const lines = this.markdown.split('\n')

    let currentArea = ''
    let currentGoal: Partial<Goal> = {}
    let inDiscoveryNotes = false
    let discoveryNotes = ''

    for (const line of lines) {
      // Check for H2 headers (goal areas)
      if (line.startsWith('## ')) {
        // Save previous goal if complete
        if (currentArea && currentGoal.outcome) {
          goals.push({
            area: currentArea,
            outcome: currentGoal.outcome ?? '',
            currentState: currentGoal.currentState ?? '',
            whyItMatters: currentGoal.whyItMatters ?? '',
          })
        }

        currentArea = line.slice(3).trim()
        currentGoal = {}

        if (currentArea === 'Discovery Notes') {
          inDiscoveryNotes = true
          currentArea = ''
          continue
        }
        inDiscoveryNotes = false
        continue
      }

      if (inDiscoveryNotes) {
        discoveryNotes += line + '\n'
        continue
      }

      // Parse **Key:** Value patterns
      const outcomeMatch = line.match(/^\*\*Outcome:\*\*\s*(.+)/)
      if (outcomeMatch) {
        currentGoal.outcome = outcomeMatch[1].trim()
        continue
      }

      const currentStateMatch = line.match(/^\*\*Current State:\*\*\s*(.+)/)
      if (currentStateMatch) {
        currentGoal.currentState = currentStateMatch[1].trim()
        continue
      }

      const whyMatch = line.match(/^\*\*Why (?:This|It) Matters:\*\*\s*(.+)/)
      if (whyMatch) {
        currentGoal.whyItMatters = whyMatch[1].trim()
        continue
      }
    }

    // Don't forget the last goal
    if (currentArea && currentGoal.outcome) {
      goals.push({
        area: currentArea,
        outcome: currentGoal.outcome ?? '',
        currentState: currentGoal.currentState ?? '',
        whyItMatters: currentGoal.whyItMatters ?? '',
      })
    }

    this._goals = goals
    this._discoveryNotes = discoveryNotes.trim() || null
  }

  /**
   * Create a new GoalDocument with initial goals
   */
  static create(input: { category: GoalCategory; title?: string; goals?: Goal[] }): GoalDocument {
    const today = PlainDate.today()

    const yaml: Record<string, unknown> = {
      title: input.title ?? `${input.category} Goals`,
      category: input.category,
      created: today.ymd,
      updated: today.ymd,
    }

    let markdown = ''
    if (input.goals && input.goals.length > 0) {
      markdown = GoalDocument.formatGoalsToMarkdown(input.goals)
    }

    return new GoalDocument(yaml, markdown)
  }

  /**
   * Format goals array to markdown body
   */
  static formatGoalsToMarkdown(goals: Goal[]): string {
    const parts: string[] = []

    for (const goal of goals) {
      parts.push(`## ${goal.area}`)
      parts.push('')
      parts.push(`**Outcome:** ${goal.outcome}`)
      parts.push(`**Current State:** ${goal.currentState}`)
      parts.push(`**Why It Matters:** ${goal.whyItMatters}`)
      parts.push('')
    }

    return parts.join('\n').trim()
  }

  /**
   * Load a GoalDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): GoalDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new GoalDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
