import type { TimingRecord } from './mod.ts'

/** Starts survive crashes; a matching end replaces its start. Ignore torn/unrelated lines. */
export function parseTimingLog(text: string): TimingRecord[] {
  const records = new Map<string, TimingRecord>()
  for (const line of text.split('\n')) {
    try {
      const value = JSON.parse(line)
      const span = value?.span
      if (
        !['timing-start', 'timing-end'].includes(value?.event) ||
        !span ||
        typeof span.traceId !== 'string' ||
        typeof span.spanId !== 'string' ||
        typeof span.kind !== 'string' ||
        typeof span.name !== 'string' ||
        !Number.isFinite(span.startMs) ||
        (span.durationMs !== undefined && (!Number.isFinite(span.durationMs) || span.durationMs < 0))
      )
        continue
      const key = `${span.traceId}/${span.spanId}`
      if (value.event === 'timing-end' || !records.has(key)) records.set(key, span)
    } catch {
      /* An interrupted append can leave a partial final line. */
    }
  }
  return [...records.values()]
}
