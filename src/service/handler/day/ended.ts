import type DayDocument from '#shared/models/Day/document/mod.ts'

export function dayEnd(document: DayDocument): { ended: boolean; endedAt: string | null } {
  const marker = document.yaml['ended']
  const ended = typeof marker === 'string' ? marker.trim() !== '' : Boolean(marker)
  let endedAt: string | null = null
  if (ended) {
    try {
      endedAt = document.ended?.plainDateTime.toString() ?? null
    } catch {
      // An unreadable end time must not reopen the day or hide its lists.
    }
  }
  return { ended, endedAt }
}
