import { Lexer } from 'marked'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { itemEditFields, type DayEditFields } from './editingTypes.ts'
import { orderPlanList } from './order.ts'

export class ItemEditError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 409,
  ) {
    super(message)
  }
}

export interface PlanBlock {
  from: number
  to: number
  raw: string
  block: string
}
export interface PlanSection {
  title: string
  end: number
  rows: PlanBlock[]
}

/** Parse actual top-level tasks, ignoring nested notes and examples in fenced code. */
export function planSections(content: string): PlanSection[] {
  const offsets: number[] = []
  for (let i = 0; i < content.length; i++) {
    offsets.push(i)
    if (content[i] === '\r' && content[i + 1] === '\n') i++
  }
  offsets.push(content.length)
  const normalized = content.replace(/\r\n/g, '\n')
  const result: PlanSection[] = []
  let section: PlanSection | null = null
  let cursor = 0
  for (const token of Lexer.lex(normalized)) {
    const start = normalized.indexOf(token.raw, cursor)
    if (start < 0) continue
    cursor = start + token.raw.length
    if (token.type === 'heading') {
      if (section) section.end = offsets[start]
      section = token.depth === 2 ? { title: token.text.trim(), end: content.length, rows: [] } : null
      if (section) result.push(section)
    }
    if (!section || token.type !== 'list' || token.ordered) continue
    let at = start
    for (const item of token.items) {
      const from = normalized.indexOf(item.raw, at)
      at = from + item.raw.length
      const to = from + item.raw.replace(/\n+$/, '').length
      if (from < start || to > cursor) throw new ItemEditError('This item could not be located. Reload the day.')
      section.rows.push({
        from: offsets[from],
        to: offsets[to],
        raw: item.raw
          .split('\n')[0]
          .replace(/^\s*[-*+]\s*/, '')
          .trim(),
        block: content.slice(offsets[from], offsets[to]),
      })
    }
  }
  return result
}

export function planSection(content: string, title: string): PlanSection | undefined {
  const found = planSections(content).filter((section) => section.title === title)
  if (found.length > 1) throw new ItemEditError('This list heading appears more than once. Edit it in the day file.')
  return found[0]
}

export function editableRow(content: string, list: string, raw: string): PlanBlock & { index: number } {
  if (!/^(?:most important|reminders|(?:.*\s)?(?:todos|commitments|incomplete))$/i.test(list))
    throw new ItemEditError('This list is not editable here.', 400)
  const rows = planSection(content, list)?.rows ?? []
  const matches = rows.filter((row) => row.raw === raw.split(/\r?\n/)[0])
  if (matches.length !== 1)
    throw new ItemEditError(
      matches.length
        ? 'There are identical items in this list. Edit them in the day file.'
        : 'This item changed. Your draft is kept; reload the day before trying again.',
    )
  return { ...matches[0], index: rows.indexOf(matches[0]) }
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
