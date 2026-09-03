/**
 * Pure logic for the day:items commands: how a day's lists read aloud,
 * and how one item is found by a few of its words. Striking the found
 * item is `DayDocument.toggleItem`'s job — the writer beside
 * `isItemDone`, editing one line of the file in place.
 *
 * A day's actionable items live in Most Important, the Commitments and
 * Todos pairs, Reminders, and Streaks; Complete lists record what already
 * happened and are never searched. Items carry markdown a voice must not
 * read — strikethrough, reference links — so reading and matching share
 * one normalization.
 */

import DayDocument from '#shared/models/Day/mod.ts'

/** The three lists an item can be added to by name. */
export type DayListKind = 'todos' | 'commitments' | 'reminders'

/** Loose list name → canonical kind: "todo", "Commitments", "reminder" all resolve. */
export function parseListKind(input: string): DayListKind | undefined {
  const bare = input.trim().toLowerCase().replace(/s$/, '')
  if (bare === 'todo') return 'todos'
  if (bare === 'commitment') return 'commitments'
  if (bare === 'reminder') return 'reminders'
  return undefined
}

export interface DayItem {
  /** The item as it reads aloud: no strike marks, links flattened to their labels. */
  text: string
  done: boolean
}

export interface DayItemList {
  title: string
  items: DayItem[]
}

/** One item as it reads aloud; the `HH:MM >` prefix stays — it is information. */
export function cleanItemText(raw: string): string {
  let text = raw.replace(/~~/g, '').trim()
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links → label
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // inline links → label
  return text.replace(/\s+/g, ' ').trim()
}

/** The matching form: cleaned, time prefix dropped, case folded. */
export function normalizeForMatch(raw: string): string {
  return cleanItemText(raw)
    .replace(/^\d{1,2}:\d{2}\s*>\s*/, '')
    .toLowerCase()
}

/** Every list of the day in document order, items cleaned for reading. */
export function listDayItems(day: DayDocument): DayItemList[] {
  return day.lists.map((list) => ({
    title: list.title,
    items: list.items.map((raw) => ({ text: cleanItemText(raw), done: DayDocument.isItemDone(raw) })),
  }))
}

export interface FoundItem {
  listTitle: string
  index: number
  raw: string
}

export type ItemSearch =
  | { kind: 'one'; match: FoundItem }
  | { kind: 'many'; matches: FoundItem[] }
  | { kind: 'already-done'; match: FoundItem }
  | { kind: 'none' }

/** Whether a list can hold a not-yet-done item; Complete lists are records, not plans. */
function searchable(title: string): boolean {
  return !title.endsWith('Complete')
}

function listMatchesKind(title: string, kind: DayListKind): boolean {
  if (kind === 'todos') return title.endsWith('Todos')
  if (kind === 'commitments') return title.endsWith('Commitments')
  return title === 'Reminders'
}

/**
 * Find the one item a few words name. Matching is substring over the
 * normalized text, across every searchable list (or one kind of list).
 * Struck items only count when nothing pending matches — asking to finish
 * a finished thing deserves "already done", not "not found".
 */
export function findDayItem(day: DayDocument, query: string, kind?: DayListKind): ItemSearch {
  const q = normalizeForMatch(query)
  if (!q) return { kind: 'none' }

  const pending: FoundItem[] = []
  const done: FoundItem[] = []
  for (const list of day.lists) {
    if (!searchable(list.title)) continue
    if (kind && !listMatchesKind(list.title, kind)) continue
    list.items.forEach((raw, index) => {
      if (!normalizeForMatch(raw).includes(q)) return
      const found = { listTitle: list.title, index, raw }
      if (DayDocument.isItemDone(raw)) done.push(found)
      else pending.push(found)
    })
  }

  if (pending.length === 1) return { kind: 'one', match: pending[0] }
  if (pending.length > 1) return { kind: 'many', matches: pending }
  if (done.length > 0) return { kind: 'already-done', match: done[0] }
  return { kind: 'none' }
}
