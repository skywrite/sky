import { z } from 'zod'
import { planSections } from '#lib/nbfs/listBlocks.ts'
import { priorityGroupOf, priorityOrder, priorityOrderRows, type PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import { hash } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import type { PriorityEvidence } from './priorityAI.ts'

const orderEntry = z.object({ key: z.string(), manual: z.boolean() })
export const PrioritySnapshot = z.object({
  rest: z.string(),
  rows: z.array(z.object({ key: z.string(), signature: z.string(), done: z.boolean(), manual: z.boolean() })),
  orders: z.object({ todos: z.array(orderEntry), reminders: z.array(orderEntry) }),
  context: z.array(z.object({ path: z.string(), revision: z.string() })),
})
export type PrioritySnapshot = z.infer<typeof PrioritySnapshot>

/** Completion and clearing change membership, not the evidence behind the surviving items' order. */
export function prioritySnapshot(content: string, context: PriorityEvidence['context']): PrioritySnapshot {
  const document = DayDocument.fromMarkdown(content)
  let rest = document.markdown
  const blocks = planSections(rest)
    .filter((section) => priorityGroupOf(section.title))
    .flatMap((section) => section.rows)
  for (const block of blocks.reverse()) rest = rest.slice(0, block.from) + rest.slice(block.to)
  const yaml = Object.entries(document.yaml)
    .filter(([key]) => key !== 'todo-order' && key !== 'reminder-order')
    .sort(([a], [b]) => a.localeCompare(b))
  const order = (group: PriorityGroup) =>
    priorityOrder(content, group).map(({ list, text, occurrence, manual }) => ({
      key: JSON.stringify({ list, text, occurrence }),
      manual: manual !== false,
    }))
  return {
    rest: hash(
      JSON.stringify([
        yaml,
        rest
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .join('\n'),
      ]),
    ),
    rows: (['todos', 'reminders'] as const).flatMap((group) =>
      priorityOrderRows(content, group).map((row) => ({
        key: JSON.stringify(row.entry),
        signature: hash(JSON.stringify([row.list, row.entry.text, row.block.split(/\r?\n/).slice(1)])),
        done: row.done,
        manual: row.manual,
      })),
    ),
    orders: { todos: order('todos'), reminders: order('reminders') },
    context: context.map(({ path, ...evidence }) => ({ path, revision: hash(JSON.stringify(evidence)) })),
  }
}

/** Maps today's row identities to the ranking's identities, including copies renumbered after deletion. */
export function reusePrioritySnapshot(
  saved: PrioritySnapshot,
  current: PrioritySnapshot,
  sources: string[],
): Map<string, string> | null {
  if (saved.rest !== current.rest) return null
  const context = new Map(saved.context.map((document) => [document.path, document.revision]))
  for (const document of current.context) {
    if (context.get(document.path) !== document.revision) return null
    context.delete(document.path)
  }
  // A removed item's linked document can leave the selected context. Deleting a still-selected source is new evidence.
  if (
    [...context.keys()].some((file) =>
      sources.some((source) => (source.endsWith('/') ? file.startsWith(source) : file === source)),
    )
  )
    return null
  const remaining = new Set(saved.rows)
  const identities = new Map<string, string>()
  for (const row of current.rows) {
    const matches = [...remaining].filter((candidate) => candidate.signature === row.signature)
    const previous =
      matches.find((candidate) => candidate.manual === row.manual && candidate.done === row.done) ??
      matches.find((candidate) => candidate.manual === row.manual) ??
      matches[0]
    if (!previous) return null
    identities.set(row.key, previous.key)
    remaining.delete(previous)
  }
  return identities
}

export function samePriorityOverrides(
  saved: PrioritySnapshot,
  current: PrioritySnapshot,
  group: PriorityGroup,
  identities: Map<string, string>,
) {
  const remaining = new Set(identities.values())
  const previous = saved.orders[group].filter((entry) => remaining.has(entry.key))
  const next = current.orders[group].map((entry) => ({ ...entry, key: identities.get(entry.key) ?? entry.key }))
  return JSON.stringify(previous) === JSON.stringify(next)
}
