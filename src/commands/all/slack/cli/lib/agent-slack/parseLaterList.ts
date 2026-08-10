import type { AgentSlackLaterList } from './types.ts'

/** Parse `agent-slack later list` JSON output; null when the output isn't the expected shape. */
export default function parseLaterList(stdout: string): AgentSlackLaterList | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const items = Array.isArray(record.items)
    ? record.items.filter(
        (item): item is AgentSlackLaterList['items'][number] =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).channel_id === 'string' &&
          typeof (item as Record<string, unknown>).ts === 'string',
      )
    : []

  const countsRaw = (record.counts ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

  return {
    items,
    counts: {
      in_progress: num(countsRaw.in_progress),
      total: num(countsRaw.total),
    },
  }
}
