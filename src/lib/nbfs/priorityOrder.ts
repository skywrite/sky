import { hash } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { listRow, planSections } from './listBlocks.ts'
import { setPlanOrder } from './planOrder.ts'

export interface PriorityOrderEntry {
  list: string
  text: string
  occurrence: number
  /** Only the rows the person moved are pinned; other rows can follow new suggestions. */
  manual?: boolean
}
export type PriorityGroup = 'todos' | 'reminders'
export const priorityOrderKey = (group: PriorityGroup) => (group === 'todos' ? 'todo-order' : 'reminder-order')
export const priorityGroupOf = (list: string): PriorityGroup | null =>
  isTodoList(list) ? 'todos' : /^reminders$/i.test(list) ? 'reminders' : null
interface Address {
  list: string
  raw: string
  occurrence?: number
}

export const isTodoList = (list: string) => /^(?:.*\s)?(?:todos|commitments|incomplete)$/i.test(list)
const unstruck = (text: string) => text.replace(/^~~(.*)~~$/, '$1').replace(/^(\d{1,2}:\d{2}\s*>?\s*)~~(.*)~~$/, '$1$2')
const key = (entry: PriorityOrderEntry) => JSON.stringify([entry.list, entry.text, entry.occurrence])
export const priorityAddressKey = (item: Address) =>
  JSON.stringify([item.list, item.raw.split(/\r?\n/)[0], item.occurrence ?? 0])

/** Readable cross-list order. Completion marks are not part of a task's priority identity. */
export function priorityOrder(content: string, group: PriorityGroup = 'todos'): PriorityOrderEntry[] {
  const value = DayDocument.fromMarkdown(content).yaml[priorityOrderKey(group)]
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is PriorityOrderEntry =>
          entry &&
          typeof entry.list === 'string' &&
          priorityGroupOf(entry.list) === group &&
          typeof entry.text === 'string' &&
          Number.isSafeInteger(entry.occurrence) &&
          entry.occurrence >= 0,
      )
    : []
}

export function priorityOrderRows(content: string, group: PriorityGroup = 'todos') {
  const entries = priorityOrder(content, group)
  const order = new Map(entries.map((entry, index) => [key(entry), index]))
  const rows = planSections(content)
    .filter((section) => priorityGroupOf(section.title) === group)
    .flatMap((section) => {
      const occurrences = new Map<string, number>()
      const identities = new Map<string, number>()
      return section.rows
        .filter((row) => row.raw)
        .map((row) => {
          const text = unstruck(row.raw)
          const occurrence = occurrences.get(row.raw) ?? 0
          const identity = identities.get(text) ?? 0
          occurrences.set(row.raw, occurrence + 1)
          identities.set(text, identity + 1)
          const entry = { list: section.title, text, occurrence: identity }
          return { ...row, list: section.title, occurrence, entry, done: DayDocument.isItemDone(row.raw) }
        })
    })
  return rows
    .map((row, position) => ({
      ...row,
      priority: order.get(key(row.entry)) ?? entries.length + position,
      manual: order.has(key(row.entry)) && entries[order.get(key(row.entry))!].manual !== false,
    }))
    .sort((a, b) => a.priority - b.priority)
}

export const priorityOrderRevision = (content: string, group: PriorityGroup = 'todos') =>
  hash(
    JSON.stringify([
      priorityOrder(content, group),
      priorityOrderRows(content, group).map((row) => priorityAddressKey(row)),
    ]),
  )

/** Follow explicit edits/deletions, including identical copies whose occurrence changes. */
export function rebasePriorityOrder(
  before: string,
  after: string,
  changes: Array<{ before: Address; after?: Address }> = [],
): string {
  for (const group of ['todos', 'reminders'] as const) after = rebaseGroup(before, after, changes, group)
  return after
}

function rebaseGroup(
  before: string,
  after: string,
  changes: Array<{ before: Address; after?: Address }>,
  group: PriorityGroup,
): string {
  const order = priorityOrder(before, group)
  if (!order.length) return after
  const oldRows = priorityOrderRows(before, group).sort((a, b) => a.from - b.from)
  const newRows = priorityOrderRows(after, group).sort((a, b) => a.from - b.from)
  const remaining = new Set(newRows)
  const mapped = new Map<string, PriorityOrderEntry>()
  const changed = new Set<string>()
  for (const change of changes) {
    const oldRow = oldRows.find((row) => priorityAddressKey(row) === priorityAddressKey(change.before))
    const next = change.after && newRows.find((row) => priorityAddressKey(row) === priorityAddressKey(change.after!))
    if (next) remaining.delete(next)
    if (!oldRow) continue
    changed.add(key(oldRow.entry))
    if (next) {
      mapped.set(key(oldRow.entry), next.entry)
    }
  }
  for (const row of oldRows) {
    if (changed.has(key(row.entry))) continue
    const next = [...remaining].find(
      (candidate) => candidate.list === row.list && candidate.entry.text === row.entry.text,
    )
    if (!next) continue
    mapped.set(key(row.entry), next.entry)
    remaining.delete(next)
  }
  const entries = order.flatMap((entry) => {
    const next = mapped.get(key(entry))
    return next ? [{ ...next, ...(entry.manual !== undefined ? { manual: entry.manual } : {}) }] : []
  })
  return JSON.stringify(entries) === JSON.stringify(priorityOrder(after, group))
    ? after
    : setPlanOrder(after, priorityOrderKey(group), entries)
}

/** Editing a task keeps its place even when its title, time or category changes. */
export function replacePriorityOrder(
  before: string,
  after: string,
  source: Address,
  destination: { list: string; block: string; index?: number },
): string {
  if (!priorityOrder(before).length && !priorityOrder(before, 'reminders').length) return after
  const sourceRow = listRow(before, source.list, source.raw, source.occurrence)
  const targetRaw = destination.block
    .split(/\r?\n/)[0]
    .replace(/^\s*[-*+]\s*/, '')
    .trim()
  const sourceRows = planSections(before).find((section) => section.title === destination.list)?.rows ?? []
  const insertion = destination.list === source.list ? sourceRow.index : (destination.index ?? sourceRows.length)
  const occurrence = sourceRows.slice(0, insertion).filter((row) => row.raw === targetRaw).length
  return rebasePriorityOrder(before, after, [
    { before: source, after: { list: destination.list, raw: targetRaw, occurrence } },
  ])
}
