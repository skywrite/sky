import { z } from 'zod'
import type { CalendarJob, CalendarJobBatch } from './types.ts'

export const calendarDraftIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(50)
  .transform((ids) => [...new Set(ids)])

/** One CLI/tool call can name all the immutable drafts in a scheduling request. */
export function calendarDraftIds(value: unknown): string[] {
  const text = z.string().trim().min(1).parse(value)
  return calendarDraftIdsSchema.parse(text.split(',').map((id) => id.trim().toLowerCase()))
}

export function calendarBatch(jobs: CalendarJob[]): CalendarJobBatch {
  const state = jobs.some((job) => job.state === 'creating')
    ? 'creating'
    : jobs.some((job) => job.state === 'uncertain')
      ? 'uncertain'
      : jobs.some((job) => job.state === 'failed')
        ? 'failed'
        : 'created'
  return { state, jobs }
}
