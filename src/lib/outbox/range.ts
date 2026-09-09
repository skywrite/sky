import { z } from 'zod'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const Minute = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => {
    try {
      return PlainDateTime.fromString(value.replace('T', ' ')).toString() === value.replace('T', ' ')
    } catch {
      return false
    }
  }, 'Use a valid date and time.')

/** Inclusive minutes in the notebook's message timestamps, without a UTC conversion. */
export const ScanRangeSchema = z
  .object({ start: Minute, end: Minute })
  .refine(({ start, end }) => start <= end, 'The end must be on or after the start.')
export type ScanRange = z.infer<typeof ScanRangeSchema>
export type SavedScanRange = { value: ScanRange; revision: string }

export function dayRange(day: string): ScanRange {
  return ScanRangeSchema.parse({ start: `${day}T00:00`, end: `${day}T23:59` })
}

export function rangeLabel(range: ScanRange): string {
  return `${range.start.replace('T', ' ')} through ${range.end.replace('T', ' ')}`
}

export function rangeKey(range: ScanRange): string {
  return `${range.start}/${range.end}`
}

export function inRange(minute: string, range: ScanRange): boolean {
  const value = minute.replace(' ', 'T').slice(0, 16)
  return value >= range.start && value <= range.end
}
