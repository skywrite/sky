/**
 * The week's plan as data: week.md read by heading. Priorities are the
 * ranked stack; goals live under `## Goals`, one `###` per category, one
 * bullet each with an indented WHY beneath it. A `~~struck~~` goal is done
 * by the person's own hand — the plan has no checkbox syntax, and no
 * command writes into it. Nothing here decides anything about the plan.
 */

import { parsePriorities } from '#commands/all/week/lib/weekMarkdown.ts'

export interface PlanGoal {
  /** The `###` heading the goal sits under: Professional, Personal */
  category: string
  text: string
  /** Struck through by hand */
  done: boolean
  /** The bullet exactly as written, strike marks included */
  raw: string
}

export interface WeekPlan {
  /** The frontmatter's one-line summary, when the file has one */
  summary: string | null
  priorities: string[]
  goals: PlanGoal[]
}

const H2 = /^##\s+(.+?)\s*$/
const H3 = /^###\s+(.+?)\s*$/
/** A top-level bullet — the indented WHY lines are not goals */
const BULLET = /^-\s+(.+?)\s*$/
const STRUCK = /^~~(.*)~~$/
const FRONTMATTER = /^---\n([\s\S]*?)\n---/

function frontmatterSummary(md: string): string | null {
  const block = md.match(FRONTMATTER)?.[1]
  if (!block) return null
  const line = block.match(/^summary:\s*(.+?)\s*$/m)?.[1]
  if (!line) return null
  const quoted = line.match(/^"(.*)"$/)
  return (quoted ? quoted[1].replace(/\\"/g, '"') : line).trim() || null
}

export function parseWeekPlan(md: string): WeekPlan {
  const goals: PlanGoal[] = []
  let section = ''
  let category = ''
  for (const line of md.split('\n')) {
    const h2 = line.match(H2)
    if (h2) {
      section = h2[1]
      category = ''
      continue
    }
    if (section !== 'Goals') continue
    const h3 = line.match(H3)
    if (h3) {
      category = h3[1]
      continue
    }
    const bullet = line.match(BULLET)
    if (!bullet || !category) continue
    const raw = bullet[1]
    const struck = raw.match(STRUCK)
    goals.push({ category, text: (struck ? struck[1] : raw).trim(), done: Boolean(struck), raw })
  }
  return {
    summary: frontmatterSummary(md),
    priorities: parsePriorities(md).map((priority) => priority.text),
    goals,
  }
}
