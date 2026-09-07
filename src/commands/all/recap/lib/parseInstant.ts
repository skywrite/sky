import { Instant } from '#universal/dates/nbdt/mod.ts'

/** Invalid or incomplete log records must not prevent the rest of a recap. */
export function parseInstant(value: unknown): Instant | null {
  if (typeof value !== 'string') return null
  try {
    return Instant.from(value)
  } catch {
    return null
  }
}
