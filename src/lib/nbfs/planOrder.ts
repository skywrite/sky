import { Lexer } from 'marked'
import { parseDocument } from 'yaml'
import DayDocument from '#shared/models/Day/document/mod.ts'
type CommitmentOrder = 'time' | 'manual'
import { comparePlanItems } from './comparePlanItems.ts'

interface OrderedItem {
  from: number
  to: number
  text: string
  done: boolean
  time: string | null
}

/** Reorder whole task blocks, keeping their notes, links, and the rest of the file verbatim. */
export function orderPlanList(content: string, title: string): string {
  if (isManualPlanList(content, title)) return content
  if (!/(?:^most important$|(?:^|\s)(?:todos|commitments|incomplete)$)/i.test(title.trim())) return content
  const timed = /commitments$/i.test(title.trim())
  // Marked normalizes line endings. Map its offsets back to the original bytes.
  const offsets: number[] = []
  for (let i = 0; i < content.length; i++) {
    offsets.push(i)
    if (content[i] === '\r' && content[i + 1] === '\n') i++
  }
  offsets.push(content.length)
  const normalized = content.replace(/\r\n?/g, '\n')
  const changes: Array<{ from: number; to: number; text: string }> = []
  let cursor = 0
  const groups: OrderedItem[][] = []
  let group: OrderedItem[] | null = null
  for (const token of Lexer.lex(normalized)) {
    const start = normalized.indexOf(token.raw, cursor)
    if (start < 0) continue
    cursor = start + token.raw.length
    if (token.type === 'heading') {
      group = token.depth === 2 && token.text.trim() === title.trim() ? [] : null
      if (group) groups.push(group)
    }
    if (!group || token.type !== 'list' || token.ordered) continue
    let at = start
    const items = token.items.map((item) => {
      const from = normalized.indexOf(item.raw, at)
      at = from + item.raw.length
      const body = item.raw.replace(/\n+$/, '')
      const text = item.raw
        .split('\n')[0]
        .replace(/^\s*[-*+]\s*/, '')
        .trim()
      return {
        from,
        to: from + body.length,
        text: content.slice(offsets[from], offsets[from + body.length]),
        done: DayDocument.isItemDone(text),
        time: text.replace(/^~~|~~$/g, '').match(/^(\d{1,2}:\d{2})\s*>?/)?.[1] ?? null,
      }
    })
    if (items.some((item) => item.from < start || item.to > cursor)) continue
    group.push(...items)
  }
  for (const items of groups) {
    const sorted = [...items].sort((a, b) => comparePlanItems(a, b, timed))
    for (let i = 0; i < items.length; i++) {
      if (items[i] === sorted[i]) continue
      changes.push({ from: offsets[items[i].from], to: offsets[items[i].to], text: sorted[i].text })
    }
  }
  let result = content
  for (const change of changes.reverse()) result = result.slice(0, change.from) + change.text + result.slice(change.to)
  return result
}

export function planOrder(content: string): { manualOrder: string[]; commitmentsOrder: CommitmentOrder } {
  const yaml = DayDocument.fromMarkdown(content).yaml
  return {
    manualOrder: Array.isArray(yaml['manual-order'])
      ? yaml['manual-order'].filter((value): value is string => typeof value === 'string')
      : [],
    commitmentsOrder: yaml['commitments-order'] === 'manual' ? 'manual' : 'time',
  }
}

export function isManualPlanList(content: string, list: string): boolean {
  const order = planOrder(content)
  return /commitments$/i.test(list) ? order.commitmentsOrder === 'manual' : order.manualOrder.includes(list)
}

/** Keep frontmatter comments, the rest of the document and its line endings intact. */
export function setPlanOrder(content: string, key: 'manual-order' | 'commitments-order', value: unknown): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const match = /^(---\r?\n)([\s\S]*?)(^---[^\S\r\n]*(?:\r?\n|$))/m.exec(content)
  if (match && match.index !== 0) throw new Error('The day frontmatter must be at the start of the file.')
  const yaml = parseDocument(match?.[2] ?? '')
  if (yaml.errors.length) throw new Error('Fix the day frontmatter before changing its order.')
  if (value === undefined) yaml.delete(key)
  else yaml.set(key, value)
  const header = yaml.toString().replace(/\r?\n/g, eol)
  return match
    ? match[1] + header + content.slice(match[1].length + match[2].length)
    : `---${eol}${header}---${eol}${eol}${content}`
}
