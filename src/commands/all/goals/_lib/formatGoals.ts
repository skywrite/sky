/**
 * Format goals as markdown
 */

import type { Goal, GoalsDocument } from './parseGoals.ts'

/**
 * Format a goals document to markdown
 */
export function formatGoals(doc: GoalsDocument): string {
  const today = new Date().toISOString().slice(0, 10)
  const lines: string[] = []

  // Frontmatter
  lines.push('---')
  lines.push(`created: ${doc.created}`)
  lines.push(`updated: ${today}`)
  lines.push(`type: Goals`)
  lines.push(`category: ${doc.category}`)
  lines.push(`tags: Goals/${doc.category}`)
  lines.push('---')
  lines.push('')

  // Title
  lines.push(`# ${doc.category} Goals`)
  lines.push('')

  // Goals
  for (const goal of doc.goals) {
    lines.push(`## ${goal.area}`)
    lines.push('')
    lines.push(`**Outcome:** ${goal.outcome}`)
    lines.push(`**Current State:** ${goal.currentState}`)
    lines.push(`**Why It Matters:** ${goal.whyItMatters}`)
    lines.push('')
  }

  // Discovery notes (if any)
  if (doc.discoveryNotes) {
    lines.push('---')
    lines.push('')
    lines.push('## Discovery Notes')
    lines.push('')
    lines.push(doc.discoveryNotes)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Create an empty goals document
 */
export function createEmptyGoalsDocument(category: 'Personal' | 'Professional'): GoalsDocument {
  const today = new Date().toISOString().slice(0, 10)
  return {
    created: today,
    updated: today,
    category,
    goals: [],
  }
}

/**
 * Add a goal to a document
 */
export function addGoal(doc: GoalsDocument, goal: Goal): GoalsDocument {
  return {
    ...doc,
    goals: [...doc.goals, goal],
  }
}

/**
 * Update a goal in a document by area name
 */
export function updateGoal(doc: GoalsDocument, area: string, updates: Partial<Goal>): GoalsDocument {
  return {
    ...doc,
    goals: doc.goals.map((g) => (g.area === area ? { ...g, ...updates } : g)),
  }
}
