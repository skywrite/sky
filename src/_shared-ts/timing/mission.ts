import { formatDuration, type TimingSummary, type TimingTotal } from './summary.ts'

/** Older notebook records have only the required fields. New ones carry the shared trace summary. */
export interface MissionTiming extends Partial<TimingSummary> {
  profile: string
  steps: number
  wallMs: number
  modelMs: number
  toolMs: number
  tools: Record<string, TimingTotal>
}

export function formatTiming(t: MissionTiming): string {
  const tools = Object.entries(t.tools)
    .map(([name, v]) => `${name} ${v.count}× ${formatDuration(v.ms)}`)
    .join(', ')
  const head = `${t.steps} step${t.steps === 1 ? '' : 's'} in ${formatDuration(t.wallMs)} on ${t.profile}`
  return `${head} — model ${formatDuration(t.modelMs)}, tools ${formatDuration(t.toolMs)}${tools ? `: ${tools}` : ''}${t.overlapMs ? `; overlapping ${formatDuration(t.overlapMs)}` : ''}${t.otherMs !== undefined ? `; other ${formatDuration(t.otherMs)}` : ''}`
}

export function timingLines(t: MissionTiming): string[] {
  return [
    `- steps: ${t.steps}`,
    `- wall: ${formatDuration(t.wallMs)}`,
    `- model: ${formatDuration(t.modelMs)}`,
    `- tools: ${formatDuration(t.toolMs)}`,
    ...Object.entries(t.tools).map(([name, v]) => `  - ${name}: ${v.count}× ${formatDuration(v.ms)}`),
    ...(t.overlapMs !== undefined ? [`- overlapping: ${formatDuration(t.overlapMs)}`] : []),
    ...(t.otherMs !== undefined ? [`- other: ${formatDuration(t.otherMs)}`] : []),
    ...(t.traceId ? [`- trace: ${t.traceId}`] : []),
  ]
}
