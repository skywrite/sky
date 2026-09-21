import DayDocument from '#shared/models/Day/document/mod.ts'
import { insertBlock, planSection, planSections } from './listBlocks.ts'

// Older schedule entries infer their list from the file and a clock prefix.
// Keep that spelling where it is lossless; other lists carry a hidden, readable
// annotation on the first line so reminders and untimed commitments round-trip.
const LIST_MARKER = /\s+<!-- sky-list: (Most Important|Reminders|[^<>\r\n]+ (?:Todos|Commitments|Incomplete)) -->$/

export function readScheduledItem(block: string, category: string): { block: string; list: string } {
  const head = block.split(/\r?\n/)[0]
  const marker = LIST_MARKER.exec(head)
  const raw = head.replace(/^\s*[-*+]\s*/, '').replace(LIST_MARKER, '')
  return {
    block: head.replace(LIST_MARKER, '') + block.slice(head.length),
    list: marker?.[1] ?? `${category} ${DayDocument.itemStartsWithTime(raw) ? 'Commitments' : 'Todos'}`,
  }
}

export function scheduledBlock(block: string, list: string): string {
  const category = list.startsWith('Personal ') || list === 'Reminders' ? 'Personal' : 'Professional'
  if (readScheduledItem(block, category).list === list) return block
  if (/[<>\r\n]/.test(list)) throw new Error('Invalid scheduled task list.')
  const head = block.split(/\r?\n/)[0]
  return `${head} <!-- sky-list: ${list} -->${block.slice(head.length)}`
}

/** Keep date headings ordered without rebuilding other tasks or their attached notes. */
export function appendScheduledBlock(content: string, date: string, block: string): string {
  if (!planSection(content, date)) {
    const next = planSections(content).find(
      (section) => /^\d{4}-\d{2}-\d{2}$/.test(section.title) && section.title > date,
    )
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    const empty = `## ${date}${eol}${eol}-${eol}${eol}`
    if (next) content = content.slice(0, next.from) + empty + content.slice(next.from)
    else content = `${content}${content.endsWith(eol) ? '' : eol}${eol}${empty}`
  }
  return insertBlock(content, date, block)
}

export function emptySchedule(list: string): string {
  const category = list.startsWith('Personal ') || list === 'Reminders' ? 'Personal' : 'Professional'
  return `---\n---\n\n# ${category} Schedule\n`
}
