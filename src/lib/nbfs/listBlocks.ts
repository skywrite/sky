import { Lexer } from 'marked'

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
  from: number
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
      section =
        token.depth === 2 ? { title: token.text.trim(), from: offsets[start], end: content.length, rows: [] } : null
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

export function listRow(content: string, list: string, raw: string): PlanBlock & { index: number } {
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

export function removeBlock(content: string, list: string, raw: string): string {
  const row = listRow(content, list, raw)
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
