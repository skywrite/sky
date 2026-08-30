import DayDocument from '#shared/models/Day/mod.ts'
import type ItemList from '#shared/models/Markdown/ItemList/mod.ts'

/**
 * Carry-over of unfinished commitments between days: the document half of
 * `day:commitments:incomplete` and `day:commitments:move-future`. Pure —
 * the commands own the file I/O and the output.
 *
 * Design: src/commands/all/day/docs/README.md
 */

/** "Professional Commitments" → "Professional Incomplete". */
export function incompleteTitle(listTitle: string): string {
  return listTitle.replace(/ Commitments$/, ' Incomplete')
}

/** "Professional Commitments" → "Professional", the category `addCommitmentItem` takes. */
export function categoryOf(listTitle: string): string {
  return listTitle.replace(/ Commitments$/, '')
}

export interface SweepOptions {
  /** Drop the unfinished items instead of recording them under Incomplete. */
  cleanOnly?: boolean
}

export interface SweepResult {
  /** The day with the list swept; the input document itself when nothing was unfinished. */
  doc: DayDocument
  done: ItemList
  notDone: ItemList
}

/**
 * Split a Commitments list into done and not-done. Done items stay in the
 * list. Unfinished ones move to the category's Incomplete section, or are
 * dropped with `cleanOnly`. An Incomplete section that already exists (the
 * todo sweep usually made it first) is appended to, never duplicated.
 *
 * @returns undefined when the day has no list with that title
 */
export function sweepIncomplete(
  dayDoc: DayDocument,
  listTitle: string,
  opts: SweepOptions = {},
): SweepResult | undefined {
  const list = dayDoc.lists.find((l) => l.title === listTitle)
  if (!list) return undefined

  const notDone = list.filter(DayDocument.isItemNotDone)
  const done = list.filter(DayDocument.isItemDone)
  if (notDone.size === 0) return { doc: dayDoc, done, notDone }

  let doc = dayDoc.replaceList(listTitle, done)
  if (!opts.cleanOnly) {
    const title = incompleteTitle(listTitle)
    const existing = doc.lists.find((l) => l.title === title)
    doc = existing ? doc.replaceList(title, existing.concat(notDone)) : doc.addList(notDone.update({ title }))
  }

  return { doc, done, notDone }
}

/**
 * Append commitments to a day's list. The list is created in its place in the
 * section order when the day has none, and kept in time order, because that
 * is what `addCommitmentItem` does for every other writer of the list.
 */
export function appendCommitments(dayDoc: DayDocument, listTitle: string, items: ItemList): DayDocument {
  const category = categoryOf(listTitle)
  let doc = dayDoc
  for (const item of items.items) {
    doc = doc.addCommitmentItem(item, { category, links: items.links })
  }
  return doc
}
