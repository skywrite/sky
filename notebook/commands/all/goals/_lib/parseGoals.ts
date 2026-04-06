/**
 * Parse goals from a markdown file into structured data
 */

import Document from '#shared/models/Markdown/Document/mod.ts'

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

export interface GoalsDocument {
  /** When the goals file was created */
  created: string
  /** When the goals file was last updated */
  updated: string
  /** Category: "Personal" or "Professional" */
  category: 'Personal' | 'Professional'
  /** Array of goals */
  goals: Goal[]
  /** Optional discovery notes (AI conversation excerpts) */
  discoveryNotes?: string
}

/**
 * Parse a goals markdown file into structured data
 */
export function parseGoals(markdown: string): GoalsDocument {
  const doc = Document.fromMarkdown(markdown)
  const goals: Goal[] = []

  // Extract frontmatter
  const created = doc.created?.ymd || new Date().toISOString().slice(0, 10)
  const updated = doc.updated?.ymd || new Date().toISOString().slice(0, 10)
  const category = doc.yaml['category'] === 'Professional' ? 'Professional' : 'Personal'

  // Parse goals from H2 sections (excluding "Discovery Notes")
  const lines = markdown.split('\n')
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
          outcome: currentGoal.outcome || '',
          currentState: currentGoal.currentState || '',
          whyItMatters: currentGoal.whyItMatters || '',
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
      outcome: currentGoal.outcome || '',
      currentState: currentGoal.currentState || '',
      whyItMatters: currentGoal.whyItMatters || '',
    })
  }

  return {
    created,
    updated,
    category,
    goals,
    discoveryNotes: discoveryNotes.trim() || undefined,
  }
}

/**
 * Check if a goals document has any goals defined
 */
export function hasGoals(doc: GoalsDocument): boolean {
  return doc.goals.length > 0
}
