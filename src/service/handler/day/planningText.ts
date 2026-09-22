import { Lexer } from 'marked'
import { cleanItemText, normalizeForMatch } from '#commands/all/day/items/lib/items.ts'
import { hash } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { isManualPlanList, orderPlanList } from './order.ts'
import type { DayPlanInput, NextDayItem, NextFile } from './planningTypes.ts'

export interface NextEntry extends Omit<NextDayItem, 'path'> {
  raw: string
  item: string
  at: number
}

export { moveItemMarkdown } from '#lib/nbfs/moveItemMarkdown.ts'
import { moveItemMarkdown } from '#lib/nbfs/moveItemMarkdown.ts'

export function nextEntries(content: string, file: NextFile, dayContent: string): NextEntry[] {
  const category = file === 'next-personal.md' ? 'Personal' : 'Professional'
  const present = new Set(
    DayDocument.fromMarkdown(dayContent)
      .lists.filter((list) => /(?:todos|commitments|reminders|complete)$/i.test(list.title))
      .flatMap((list) => list.items.map(normalizeForMatch)),
  )
  const entries: NextEntry[] = []
  let list = ''
  let at = 0
  for (const token of Lexer.lex(content)) {
    if (token.type === 'heading') {
      list = token.depth === 2 && /^(Next|Week-Next|Content)$/i.test(token.text.trim()) ? token.text.trim() : ''
      at = 0
    }
    if (!list || token.type !== 'list' || token.ordered) continue
    for (const row of token.items) {
      const raw = row.raw
        .trimEnd()
        .split(/\r?\n/)[0]
        .replace(/^\s*[-*+]\s*/, '')
        .trim()
      const item = raw.replace(/^\[ \]\s+/, '')
      const index = at++
      if (!item || row.checked || DayDocument.isItemDone(item)) continue
      const unavailable = /\r?\n/.test(row.raw.trimEnd())
        ? 'Open the source to move an item with notes.'
        : /^\d{1,2}:\d{2}\s*>/.test(item)
          ? 'Timed items belong in the schedule.'
          : null
      // Include resolved references: changing a link also makes an old selection stale.
      const resolved = moveItemMarkdown(item, content, file, file)
      entries.push({
        id: hash(JSON.stringify([file, list, index, raw, resolved])),
        file,
        list,
        category,
        raw,
        item,
        at: index,
        text: cleanItemText(item),
        already: present.has(normalizeForMatch(item)),
        unavailable,
      })
    }
  }
  return entries
}

export function addPlanItem(content: string, input: DayPlanInput): { content: string; list: string; raw: string } {
  const document = DayDocument.fromMarkdown(content)
  if (input.kind === 'complete') {
    const result = document.addCompleteItem(input.text, { category: input.category, time: input.time! })
    return { content: result.toMarkdown(), list: `${input.category} Complete`, raw: `${input.time} > ${input.text}` }
  }
  const raw = input.kind === 'commitments' ? `${input.time} > ${input.text}` : input.text
  const list =
    input.kind === 'reminders' ? 'Reminders' : `${input.category} ${input.kind === 'todos' ? 'Todos' : 'Commitments'}`
  const result =
    input.kind === 'reminders'
      ? document.addReminderItem(raw)
      : input.kind === 'commitments'
        ? document.addCommitmentItem(raw, { category: input.category, sort: !isManualPlanList(content, list) })
        : document.addTodoItem(raw, { category: input.category })
  return { content: orderPlanList(result.toMarkdown(), list), list, raw }
}

interface PlanningRow {
  line: number
  length: number
  raw: string
}

/** Use the markdown structure so an example inside a code fence can never be moved as a task. */
function planningRows(content: string, title: string): PlanningRow[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const rows: PlanningRow[] = []
  let cursor = 0
  let inside = false
  for (const token of Lexer.lex(normalized)) {
    const start = normalized.indexOf(token.raw, cursor)
    if (start < 0) continue
    cursor = start + token.raw.length
    if (token.type === 'heading') inside = token.depth === 2 && token.text.trim() === title
    if (!inside || token.type !== 'list' || token.ordered) continue
    let rowCursor = start
    for (const row of token.items) {
      const at = normalized.indexOf(row.raw, rowCursor)
      rowCursor = at + row.raw.length
      rows.push({
        line: normalized.slice(0, at).split('\n').length - 1,
        length: row.raw.trimEnd().split('\n').length,
        raw: row.raw
          .split('\n')[0]
          .replace(/^\s*[-*+]\s*/, '')
          .trim(),
      })
    }
  }
  return rows
}

/** Planning matches the exact live item, never a completed item with the same label. */
export function removePlanItem(
  content: string,
  list: string,
  raw: string,
): { kind: 'written'; content: string } | { kind: 'missing' } {
  const lines = content.split('\n')
  const rows = planningRows(content, list)
  const row = rows.find((row) => row.raw === raw.trim())
  if (!row || row.length > 1) return { kind: 'missing' }
  if (rows.length === 1) lines[row.line] = lines[row.line].replace(/^(\s*[-*+]).*$/, '$1')
  else lines.splice(row.line, 1)
  return { kind: 'written', content: lines.join('\n') }
}

export function restorePlanItem(
  content: string,
  list: string,
  raw: string,
  at: number,
): { kind: 'written'; content: string } | { kind: 'missing' | 'unchanged' } {
  const rows = planningRows(content, list)
  if (!rows.length) return { kind: 'missing' }
  if (rows.some((row) => row.raw === raw.trim())) return { kind: 'unchanged' }
  const lines = content.split('\n')
  const empty = rows.find((row) => !row.raw)
  const neighbor = empty ?? rows[Math.min(at, rows.length - 1)]
  const prefix = /^(\s*[-*+])/.exec(lines[neighbor.line])?.[1] ?? '-'
  const item = `${prefix} ${raw}${content.includes('\r\n') ? '\r' : ''}`
  if (empty) lines[empty.line] = item
  else lines.splice(at < rows.length ? neighbor.line : neighbor.line + neighbor.length, 0, item)
  return { kind: 'written', content: lines.join('\n') }
}
