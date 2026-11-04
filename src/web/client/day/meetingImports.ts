import type { ImportJob } from '../import/import.tsx'
import type { ScheduledMeeting } from './dayRail.tsx'

/**
 * Which of the day's meetings an import is filing. The time chosen for the
 * import ties it to a meeting by the rule the schedule uses for a filed
 * record — within fifteen minutes of the start, nearest first, one meeting
 * each — so the row that says `importing` is the row that will say `filed`.
 */

/** The schedule's tolerance for a record's start, `START_TOLERANCE_MINUTES` in meetingCheck.ts. */
const START_TOLERANCE_MINUTES = 15

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** The `HH:MM` a meeting import was started for on `ymd`, else null. */
function startOn(job: ImportJob, ymd: string): string | null {
  if (job.fields?.kind !== 'meeting') return null
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/.exec(job.fields.when)
  return match?.[1] === ymd ? match[2]! : null
}

/**
 * Running, waiting on the person, or filed while the schedule has not read
 * the record yet — the row shows the filed record from the import until then.
 */
function filing(job: ImportJob, listed: ReadonlySet<string>): boolean {
  if (job.readback.refusal) return false
  if (job.state === 'done') return job.result !== null && !listed.has(job.result.file)
  return job.state === 'running' || job.state === 'needs-you'
}

export function meetingImports(
  meetings: readonly ScheduledMeeting[],
  imports: readonly ImportJob[],
  ymd: string,
): Map<ScheduledMeeting, ImportJob> {
  const listed = new Set(meetings.flatMap((meeting) => (meeting.record ? [meeting.record.path] : [])))
  const remaining = new Map<ImportJob, number>()
  for (const job of imports) {
    const start = startOn(job, ymd)
    if (start !== null && filing(job, listed)) remaining.set(job, minutesOf(start))
  }
  const found = new Map<ScheduledMeeting, ImportJob>()
  for (const meeting of meetings) {
    if (meeting.record || meeting.allDay || !meeting.start || meeting.classification?.type === 'notification') continue
    const start = minutesOf(meeting.start)
    const match = [...remaining]
      .filter(([, at]) => Math.abs(at - start) <= START_TOLERANCE_MINUTES)
      .sort(([, a], [, b]) => Math.abs(a - start) - Math.abs(b - start))[0]?.[0]
    if (!match) continue
    remaining.delete(match)
    found.set(meeting, match)
  }
  return found
}
