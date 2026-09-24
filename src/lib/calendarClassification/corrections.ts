import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { missing, readJson } from '#lib/jobs/files.ts'

const Example = z.object({
  account: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string(),
  organizer: z.string().nullable(),
  attendees: z.array(z.string()),
  selfResponse: z.enum(['accepted', 'declined', 'tentative', 'needsAction']).nullable(),
  recurringEventId: z.string().nullable(),
})

export const Correction = z.object({
  type: z.enum(['meeting', 'notification']).nullable(),
  example: Example.optional(),
})

type SavedCorrection = z.infer<typeof Correction> & { key: string }

export function correctionExample(event: CalendarEvent): z.infer<typeof Example> | undefined {
  const example = {
    account: event.account.toLowerCase(),
    calendarId: event.calendarId ?? 'primary',
    title: event.title,
    description: event.description ?? '',
    organizer: event.organizer?.email?.toLowerCase() ?? null,
    attendees: event.attendees.filter((guest) => !guest.self).map((guest) => guest.name ?? guest.email),
    selfResponse: event.selfResponse ?? event.attendees.find((guest) => guest.self)?.response ?? null,
    recurringEventId: event.recurringEventId ?? null,
  }
  // The correction still saves when an event is too large to be a compact example.
  return JSON.stringify(example).length <= 3_000 ? example : undefined
}

export async function readCorrections(dir: string): Promise<SavedCorrection[]> {
  const folder = path.join(dir, 'overrides')
  const files = await readdir(folder).catch((error: unknown) => {
    if (missing(error)) return []
    throw error
  })
  const corrections: SavedCorrection[] = []
  for (const file of files.sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
    const saved = Correction.safeParse(await readJson(path.join(folder, file)).catch(() => null))
    if (saved.success && saved.data.type && saved.data.example)
      corrections.push({ ...saved.data, key: file.slice(0, -5) })
  }
  return corrections
}

const titleWords = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((word) => !['the', 'and', 'with', 'for'].includes(word)),
  )

/** Corrections teach by example, never by automatically hiding every invitation from a person. */
export function relevantCorrections(event: CalendarEvent, key: string, corrections: SavedCorrection[]) {
  const words = titleWords(event.title)
  const ranked = corrections
    .flatMap((correction) => {
      const example = correction.example
      if (
        !example ||
        correction.key === key ||
        example.account !== event.account.toLowerCase() ||
        example.calendarId !== (event.calendarId ?? 'primary')
      )
        return []
      const previousWords = titleWords(example.title)
      const overlap = [...words].filter((word) => previousWords.has(word)).length
      const series = Boolean(event.recurringEventId && event.recurringEventId === example.recurringEventId)
      const score = series ? 2 : overlap / Math.max(words.size, previousWords.size, 1)
      return score > 0 ? [{ score, correction }] : []
    })
    .sort((a, b) => b.score - a.score || a.correction.key.localeCompare(b.correction.key))
  let remaining = 6_000
  return ranked.slice(0, 4).flatMap(({ correction }) => {
    const example = { type: correction.type, event: correction.example! }
    const length = JSON.stringify(example).length
    if (length > remaining) return []
    remaining -= length
    return [example]
  })
}
