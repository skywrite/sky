import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { addUsage, formatTokens, NO_USAGE, type TokenUsage, totalInput } from '#universal/ai/tokenUsage.ts'

/** One row of the rollup: a model or a command, with its calls summed. */
export interface UsageRow extends TokenUsage {
  name: string
  calls: number
}

/** Records whose day (`YYYY-MM-DD` of the stamp) is on or after `since`. */
export function recordsSince(records: AIUsageRecord[], since: string): AIUsageRecord[] {
  return records.filter((r) => r.ts.slice(0, 10) >= since)
}

/** Sum the records by one of their fields, largest readers first. */
export function rollup(records: AIUsageRecord[], by: 'model' | 'source'): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  for (const r of records) {
    const key = r[by]
    const row = rows.get(key) ?? { name: key, calls: 0, ...NO_USAGE }
    const sum = addUsage(row, r)
    rows.set(key, { ...row, ...sum, calls: row.calls + 1 })
  }
  return [...rows.values()].toSorted((a, b) => totalInput(b) - totalInput(a))
}

/** Parse the log's lines; a line that is not a record is skipped, never fatal. */
export function parseUsageLog(text: string): AIUsageRecord[] {
  const records: AIUsageRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as Partial<AIUsageRecord>
      if (typeof r.ts === 'string' && typeof r.model === 'string' && typeof r.source === 'string') {
        records.push({
          ts: r.ts,
          source: r.source,
          provider: r.provider ?? '',
          model: r.model,
          input: r.input ?? 0,
          cacheRead: r.cacheRead ?? 0,
          cacheWrite: r.cacheWrite ?? 0,
          output: r.output ?? 0,
        })
      }
    } catch {
      // not a record
    }
  }
  return records
}

/** The share of everything read that came from the cache, as a whole percent. */
export function cachedShare(row: TokenUsage): number {
  const read = totalInput(row)
  return read === 0 ? 0 : Math.round((row.cacheRead / read) * 100)
}

/** A fixed-width table: name, calls, and the four counts, cache share last. */
export function renderTable(title: string, rows: UsageRow[]): string[] {
  const head = [
    title.padEnd(28),
    'calls'.padStart(6),
    'input'.padStart(8),
    'cached'.padStart(8),
    'written'.padStart(8),
    'out'.padStart(8),
    'cache%'.padStart(7),
  ]
  const lines = [head.join(' ')]
  for (const r of rows) {
    lines.push(
      [
        r.name.slice(0, 28).padEnd(28),
        String(r.calls).padStart(6),
        formatTokens(r.input).padStart(8),
        formatTokens(r.cacheRead).padStart(8),
        formatTokens(r.cacheWrite).padStart(8),
        formatTokens(r.output).padStart(8),
        `${cachedShare(r)}%`.padStart(7),
      ].join(' '),
    )
  }
  return lines
}
