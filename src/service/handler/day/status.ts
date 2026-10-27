import type DayDocument from '#shared/models/Day/document/mod.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'

/** Minutes after the day's midnight, preserving extended notebook hours. */
export function clockMinutes(time: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(time.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export interface DayStatus {
  started: string | null
  summarized: boolean
}

export async function dayStatus(document: DayDocument, file: string): Promise<DayStatus> {
  const marker = document.yaml['started']
  const started = typeof marker === 'string' && clockMinutes(marker) !== null ? marker : null
  const summarized = await hasDaySummary(file)
  return { started, summarized }
}
