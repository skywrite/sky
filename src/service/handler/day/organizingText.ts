import { hash } from '#lib/outbox/files.ts'
import { editableRow, ItemEditError, planSection, type PlanBlock } from './editingText.ts'
import type { DayItemAddress } from './organizingTypes.ts'
import { moveItemMarkdown } from './planningText.ts'

export function blockRevision(block: string, content: string, file: string): string {
  return hash(JSON.stringify([block, moveItemMarkdown(block, content, file, file)]))
}

export function checkedBlock(content: string, file: string, address: DayItemAddress) {
  const row = editableRow(content, address.list, address.raw)
  if (blockRevision(row.block, content, file) !== address.revision)
    throw new ItemEditError('An item or its notes changed. Review the refreshed day and select again.')
  return row
}

export { removeBlock, blockRaw, insertBlock } from '#lib/nbfs/listBlocks.ts'

/** Only the supplied row slots change; prose, fenced examples and other rows retain their bytes. */
export function arrangeBlocks(content: string, slots: PlanBlock[], ordered: PlanBlock[]): string {
  let result = content
  for (let i = slots.length - 1; i >= 0; i--)
    result = result.slice(0, slots[i].from) + ordered[i].block + result.slice(slots[i].to)
  return result
}
