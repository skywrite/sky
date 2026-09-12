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

export function removeBlock(content: string, list: string, raw: string): string {
  const row = editableRow(content, list, raw)
  if (planSection(content, list)!.rows.length === 1)
    return content.slice(0, row.from) + (row.block.match(/^\s*[-*+]/)?.[0] ?? '-') + content.slice(row.to)
  const newline = content.slice(row.to).match(/^\r?\n/)?.[0] ?? ''
  return content.slice(0, row.from) + content.slice(row.to + newline.length)
}

export function blockRaw(block: string): string {
  return block
    .split(/\r?\n/)[0]
    .replace(/^\s*[-*+]\s*/, '')
    .trim()
}

/** Insert a complete block, matching the target bullet without flattening nested notes. */
export function insertBlock(content: string, list: string, input: string, index?: number): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const section = planSection(content, list)
  let block = input.replace(/\r?\n/g, eol)
  const raw = blockRaw(block)
  if (section?.rows.some((row) => row.raw === raw))
    throw new ItemEditError('An identical item is already on the destination day. Nothing was moved.')
  const prefix = block.match(/^(\s*[-*+]\s+)/)?.[0]
  const targetPrefix = section?.rows.find((row) => row.raw)?.block.match(/^(\s*[-*+]\s+)/)?.[0] ?? '- '
  if (prefix && prefix !== targetPrefix) {
    const lines = block.split(eol)
    lines[0] = targetPrefix + lines[0].slice(prefix.length)
    for (let i = 1; i < lines.length; i++)
      if (lines[i].startsWith(' '.repeat(prefix.length)))
        lines[i] = ' '.repeat(targetPrefix.length) + lines[i].slice(prefix.length)
    block = lines.join(eol)
  }
  if (!section) return `${content}${content.endsWith(eol) ? '' : eol}${eol}## ${list}${eol}${eol}${block}${eol}`
  const empty = section.rows.find((row) => !row.raw)
  if (empty) return content.slice(0, empty.from) + block + content.slice(empty.to)
  const neighbor = index === undefined ? undefined : section.rows[index]
  if (neighbor) return content.slice(0, neighbor.from) + block + eol + content.slice(neighbor.from)
  const last = section.rows.at(-1)
  if (last) return content.slice(0, last.to) + eol + block + content.slice(last.to)
  return content.slice(0, section.end) + `${eol}${block}${eol}${eol}` + content.slice(section.end)
}

/** Only the supplied row slots change; prose, fenced examples and other rows retain their bytes. */
export function arrangeBlocks(content: string, slots: PlanBlock[], ordered: PlanBlock[]): string {
  let result = content
  for (let i = slots.length - 1; i >= 0; i--)
    result = result.slice(0, slots[i].from) + ordered[i].block + result.slice(slots[i].to)
  return result
}
