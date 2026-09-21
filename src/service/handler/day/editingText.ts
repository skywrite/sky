import DayDocument from '#shared/models/Day/document/mod.ts'
import { itemEditFields, type DayEditFields } from './editingTypes.ts'
import { orderPlanList } from './order.ts'

export { ItemEditError, planSection, planSections, listRow, type PlanBlock } from '#lib/nbfs/listBlocks.ts'
import { ItemEditError, planSection, listRow, type PlanBlock } from '#lib/nbfs/listBlocks.ts'

export function editableRow(content: string, list: string, raw: string): PlanBlock & { index: number } {
  if (!/^(?:most important|reminders|(?:.*\s)?(?:todos|commitments|incomplete))$/i.test(list))
    throw new ItemEditError('This list is not editable here.', 400)
  return listRow(content, list, raw)
}

/** Replace or move the whole block, retaining its bullet, notes, links and original line endings. */
export function replaceEditedBlock(
  content: string,
  address: { list: string; raw: string; block: string },
  destination: { list: string; block: string; index?: number },
): string {
  const row = editableRow(content, address.list, address.raw)
  if (row.block !== address.block)
    throw new ItemEditError('This item or its notes changed. Reload the day before trying again.')
  const raw = destination.block
    .split(/\r?\n/)[0]
    .replace(/^\s*[-*+]\s*/, '')
    .trim()
  const duplicates =
    planSection(content, destination.list)?.rows.filter(
      (candidate) => candidate.raw === raw && candidate.from !== row.from,
    ) ?? []
  if (duplicates.length) throw new ItemEditError('An identical item already exists in that list.')
  if (destination.list === address.list) {
    return orderPlanList(content.slice(0, row.from) + destination.block + content.slice(row.to), address.list)
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const source = planSection(content, address.list)!
  const nextLine = content.slice(row.to).startsWith(eol) ? eol.length : 0
  let result =
    source.rows.length === 1
      ? content.slice(0, row.from) + (row.block.match(/^\s*[-*+]/)?.[0] ?? '-') + content.slice(row.to)
      : content.slice(0, row.from) + content.slice(row.to + nextLine)
  const target = planSection(result, destination.list)
  // Different bullet markers split a Markdown list. Match the destination's
  // marker and shift attached notes by the same indentation change.
  let block = destination.block
  const prefix = block.match(/^(\s*[-*+]\s+)/)?.[0]
  const targetPrefix = target?.rows[0]?.block.match(/^(\s*[-*+]\s+)/)?.[0]
  if (prefix && targetPrefix && prefix !== targetPrefix) {
    const lines = block.split(eol)
    lines[0] = targetPrefix + lines[0].slice(prefix.length)
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith(' '.repeat(prefix.length)))
        lines[i] = ' '.repeat(targetPrefix.length) + lines[i].slice(prefix.length)
    }
    block = lines.join(eol)
  }
  if (!target) result += `${result.endsWith(eol) ? '' : eol}${eol}## ${destination.list}${eol}${eol}${block}${eol}`
  else {
    const empty = target.rows.find((candidate) => !candidate.raw)
    const neighbor = destination.index === undefined ? undefined : target.rows[destination.index]
    if (empty) result = result.slice(0, empty.from) + block + result.slice(empty.to)
    else if (neighbor) result = result.slice(0, neighbor.from) + block + eol + result.slice(neighbor.from)
    else if (target.rows.length) {
      const last = target.rows[target.rows.length - 1]
      result = result.slice(0, last.to) + eol + block + result.slice(last.to)
    } else result = result.slice(0, target.end) + `${eol}${block}${eol}${eol}` + result.slice(target.end)
  }
  return orderPlanList(orderPlanList(result, address.list), destination.list)
}

export function editPlanItem(content: string, list: string, raw: string, fields: DayEditFields) {
  raw = raw.split(/\r?\n/)[0]
  const row = editableRow(content, list, raw)
  const original = itemEditFields({ raw, list })
  const destination =
    fields.kind === original.kind &&
    (['important', 'reminders'].includes(fields.kind) || fields.category === original.category)
      ? list
      : fields.kind === 'important'
        ? 'Most Important'
        : fields.kind === 'reminders'
          ? 'Reminders'
          : `${fields.category} ${fields.kind === 'commitments' ? 'Commitments' : 'Todos'}`
  const prefix =
    raw
      .replace(/^~~(.*)~~$/, '$1')
      .replace(/^\d{1,2}:\d{2}\s*>?\s*/, '')
      .replace(/^~~(.*)~~$/, '$1')
      .match(/^MI\/\S+(?:\s*(?:->|→))?\s*/i)?.[0] ?? ''
  let text = prefix + fields.text
  if (DayDocument.isItemDone(raw)) text = `~~${text}~~`
  const nextRaw = fields.time ? `${fields.time} > ${text}` : text
  const head = row.block.split(/\r?\n/)[0]
  const bullet = head.match(/^(\s*[-*+]\s*)/)?.[1] ?? '- '
  const block = bullet + nextRaw + row.block.slice(head.length)
  const before = { list, raw, block: row.block, index: row.index }
  const after = { list: destination, raw: nextRaw, block }
  const edited = replaceEditedBlock(content, before, after)
  after.block = editableRow(edited, after.list, after.raw).block
  return { before, after, content: edited }
}
