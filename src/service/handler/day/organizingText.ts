import { hash } from '#lib/outbox/files.ts'
import { editableRow, ItemEditError, listRow, planSection, type PlanBlock } from './editingText.ts'
import type { DayItemAddress } from './organizingTypes.ts'
import { moveItemMarkdown } from './planningText.ts'

export function blockRevision(block: string, content: string, file: string): string {
  return hash(JSON.stringify([block, moveItemMarkdown(block, content, file, file)]))
}

export function checkedBlock(content: string, file: string, address: DayItemAddress) {
  const row = editableRow(content, address.list, address.raw, address.occurrence)
  if (rowRevision(content, file, address.list, row.block, address.occurrence) !== address.revision)
    throw new ItemEditError('An item or its notes changed. Review the refreshed day and select again.')
  return row
}

/** A duplicate's occurrence is safe only while its matching sibling blocks remain unchanged. */
export function rowRevision(content: string, file: string, list: string, block: string, occurrence?: number): string {
  const revision = blockRevision(block, content, file)
  const raw = block
    .split(/\r?\n/)[0]
    .replace(/^\s*[-*+]\s*/, '')
    .trim()
  const matches = planSection(content, list)?.rows.filter((row) => row.raw === raw) ?? []
  return matches.length > 1 || occurrence
    ? hash(JSON.stringify([revision, occurrence ?? 0, matches.map((row) => blockRevision(row.block, content, file))]))
    : revision
}

/** Find an operation's own unchanged copy after unrelated rows were inserted, edited or removed. */
export function savedRow(
  content: string,
  saved: string,
  file: string,
  address: { list: string; raw: string; occurrence?: number },
) {
  const original = listRow(saved, address.list, address.raw, address.occurrence)
  const revision = blockRevision(original.block, saved, file)
  const matches = (text: string) =>
    (planSection(text, address.list)?.rows ?? []).filter(
      (row) => row.raw === original.raw && blockRevision(row.block, text, file) === revision,
    )
  const before = matches(saved)
  const current = matches(content)
  const at = before.findIndex((row) => row.from === original.from)
  if (before.length !== current.length || !current[at])
    throw new ItemEditError('This item or its matching copies changed. Review the day before undoing.')
  const row = current[at]
  const rows = planSection(content, address.list)!.rows
  return {
    ...row,
    index: rows.indexOf(row),
    occurrence: rows.filter((candidate) => candidate.raw === row.raw && candidate.from < row.from).length,
  }
}

export { removeBlock, blockRaw, insertBlock } from '#lib/nbfs/listBlocks.ts'

/** Only the supplied row slots change; prose, fenced examples and other rows retain their bytes. */
export function arrangeBlocks(content: string, slots: PlanBlock[], ordered: PlanBlock[]): string {
  let result = content
  for (let i = slots.length - 1; i >= 0; i--)
    result = result.slice(0, slots[i].from) + ordered[i].block + result.slice(slots[i].to)
  return result
}
