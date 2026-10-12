import type { Run } from './chat.tsx'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** A successful tool call can still be an unsupported request, and preparation never means creation. */
export function calendarRunLabel(run: Run): string | undefined {
  if (run.tool !== 'calendar_schedule') return undefined
  const input = record(run.input)
  const output = record(run.output)
  if (run.status === null) {
    if (run.phase === 'waiting') return 'Review before sending'
    if (input.send) return 'Creating events'
    if (input.status) return 'Checking results'
    return 'Preparing draft'
  }
  if (run.error) return 'Failed'
  if (output.status === 'unsupported') return 'Unsupported request'
  if (output.status === 'needs_input') return 'Needs details'
  if (output.status === 'ready') return 'Draft prepared'
  if (output.state === 'created') return 'Created'
  if (output.state === 'creating') return 'Still creating'
  if (output.state === 'uncertain') return 'Save unconfirmed'
  if (output.state === 'failed') return 'Failed'
  if (output.retryable === false) return 'Stopped for your input'
  if (run.status !== 'success' || output.success === false) return 'Failed'
  return input.request ? 'Preparation finished' : 'Result available'
}

export function calendarActivitySummary(runs: Run[]): string {
  const running = runs.findLast((run) => run.status === null)
  if (running) return `${calendarRunLabel(running)} · ${runs.length} ${runs.length === 1 ? 'call' : 'calls'}`
  const counts = new Map<string, number>()
  for (const run of runs) {
    const label = calendarRunLabel(run)!
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => (count > 1 ? `${label} × ${count}` : label)).join(' · ')
}
