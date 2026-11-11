import type { PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import type { DayItem } from './day.tsx'

export const isTodoItem = (item: Pick<DayItem, 'list'>) =>
  /^(?:.*\s)?(?:todos|commitments|incomplete)$/i.test(item.list)
export const priorityGroupOf = (item: Pick<DayItem, 'list'>): PriorityGroup | null =>
  isTodoItem(item) ? 'todos' : /^reminders$/i.test(item.list) ? 'reminders' : null
/** A to-do with a time is a commitment: it always sits above the to-dos without one, whatever their priorities. */
export const isTimedTodo = (item: Pick<DayItem, 'list' | 'time'>) => Boolean(item.time) && isTodoItem(item)
/** Rows reorder only among their own kind, so a drag can never carry an untimed to-do above a timed one. */
export const organizeGroup = (item: DayItem) =>
  isTodoItem(item) ? `todos-${item.done ? 'completed' : 'open'}${item.time ? '-timed' : ''}` : item.list

/** Presentation only: each item retains its original list and occurrence for writes and Undo. */
export function priorityItems(
  items: DayItem[],
  isDone: (item: DayItem) => boolean,
): { open: DayItem[]; completed: DayItem[] } {
  const open: DayItem[] = []
  const completed: DayItem[] = []
  for (const item of items) (isDone(item) ? completed : open).push(item)
  const byPriority = (a: DayItem, b: DayItem) =>
    Number(isTimedTodo(b)) - Number(isTimedTodo(a)) ||
    (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
  open.sort(byPriority)
  completed.sort(byPriority)
  return { open, completed }
}
