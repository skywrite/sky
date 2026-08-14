import { Week } from '#universal/dates/nbdt/mod.ts'

const PRIORITY_LINE = /^\s*(\d+)\.\s+(.+?)\s*$/
const INDENTED_LINE = /^\s{2,}(\S.*?)\s*$/

export interface Priority {
  text: string
  /** Indented lines under the item (the why), verbatim */
  why: string[]
}

/**
 * Pull the priority stack out of a previous week.md, verbatim including each
 * item's indented why lines — priorities are maintained across weeks: copied
 * forward for re-affirming or editing.
 */
export function parsePriorities(lastWeekMd: string): Priority[] {
  const priorities: Priority[] = []
  let current: Priority | undefined

  let section = ''
  for (const line of lastWeekMd.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/)
    if (heading) {
      section = heading[1]
      current = undefined
      continue
    }
    if (section !== 'Priorities') continue

    const item = line.match(PRIORITY_LINE)
    if (item) {
      current = { text: item[2], why: [] }
      priorities.push(current)
      continue
    }

    const indented = line.match(INDENTED_LINE)
    if (indented && current) current.why.push(indented[1])
  }

  return priorities
}

/** YAML frontmatter for a fresh week.md — dates are code-owned facts. */
export function buildWeekFrontmatter(createdYmd: string, summary: string): string {
  const oneLine = summary.replace(/\s+/g, ' ').trim()
  const value = /[:#]/.test(oneLine) ? `"${oneLine.replace(/"/g, '\\"')}"` : oneLine
  return ['---', `created: ${createdYmd}`, `updated: ${createdYmd}`, `summary: ${value}`, '---', ''].join('\n')
}

/**
 * Render a fresh week.md. After this draft the file is the user's pen alone —
 * no command ever writes into an existing week.md. Done is marked by the
 * human as ~~strikethrough~~; there is no checkbox syntax.
 */
export function renderWeekMarkdown(week: Week, createdYmd: string, priorities: Priority[] = []): string {
  const lines: string[] = []

  lines.push(buildWeekFrontmatter(createdYmd, `Week plan for ${week.toString()}`))
  lines.push(`# ${week.toString()}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('(SUMMARY)')
  lines.push('')
  lines.push('## Priorities')
  lines.push('')
  if (priorities.length) {
    priorities.forEach((priority, i) => {
      lines.push(`${i + 1}. ${priority.text}`)
      for (const why of priority.why) lines.push(`   ${why}`)
    })
  } else {
    lines.push('1. (PRIORITY)')
    lines.push('   - WHY:')
  }
  lines.push('')
  lines.push('## Goals')
  lines.push('')
  lines.push('### Professional')
  lines.push('')
  lines.push('- (GOAL)')
  lines.push('  - WHY:')
  lines.push('')
  lines.push('### Personal')
  lines.push('')
  lines.push('- (GOAL)')
  lines.push('  - WHY:')
  lines.push('')

  return lines.join('\n')
}
