import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { readOptional } from '#lib/outbox/files.ts'
import type { WorkstreamStorageConfig } from '#lib/workstreams/storagePaths.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { hasDaySummary } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { appendTaskBlock } from './fileTaskItems.ts'
import { blockRaw, planSection, removeBlock } from './listBlocks.ts'
import { moveItemMarkdown } from './moveItemMarkdown.ts'
import { writePlanningChanges } from './planningChanges.ts'
import withDayWrite from './withDayWrite.ts'

const REMINDERS_LIST = 'Reminders'
const DEFAULT_LOOKBACK_DAYS = 14
const AGES_VERSION = 1

interface ReminderAgesFile {
  version: number
  /** Normalized reminder block -> YYYY-MM-DD when the reminder was first seen. */
  firstSeen: Record<string, string>
}

export interface ReminderRolloverConfig extends WorkstreamStorageConfig {
  DIR_TIME: string
  DIR_STATE: string
  FILE_REMINDERS?: string
}

export interface ReminderRolloverOptions {
  config: ReminderRolloverConfig
  targetDay: PlainDate
  autoRollover: boolean
  expireDays: number
  lookbackDays?: number
}

export interface ReminderRolloverResult {
  moved: number
  expired: number
  deduped: number
  daysCleared: string[]
}

/** Normalize a reminder block so bullet style and trailing spaces do not create false duplicates. */
export function normalizeReminderKey(block: string): string {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  lines[0] = blockRaw(lines[0])
  return lines
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function daysBetween(from: PlainDate, to: PlainDate): number {
  const hours = new PlainDateTime({ date: from.ymd, time: '00:00' })
    .until(new PlainDateTime({ date: to.ymd, time: '00:00' }))
    .total('hours')
  return Math.round(hours / 24)
}

function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    return new PlainDate(value).ymd === value
  } catch {
    return false
  }
}

/** Every recurring reminder line defined in reminders.md, regardless of which day pattern owns it. */
export async function loadRecurringReminderKeys(remindersFile: string | undefined): Promise<Set<string>> {
  const keys = new Set<string>()
  if (!remindersFile || !(await exists(remindersFile))) return keys
  const markdown = await readTextFile(remindersFile)
  const doc = ListDocument.fromMarkdown(markdown)
  for (const list of doc.lists) {
    for (const item of list.items) {
      const normalized = blockRaw(item)
      if (normalized) keys.add(normalized)
    }
  }
  return keys
}

function readFirstSeen(raw: ReminderAgesFile | null | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || !raw.firstSeen || typeof raw.firstSeen !== 'object') return result
  for (const [key, ymd] of Object.entries(raw.firstSeen)) {
    if (key && isValidYmd(ymd)) result[key] = ymd
  }
  return result
}

/**
 * Roll unfinished reminders from recent unclosed past days onto targetDay,
 * deduplicating identical items and expiring untouched items past the configured window.
 * Recurring reminders from reminders.md expire after 1 day when expiry is enabled.
 */
export async function rolloverReminders(options: ReminderRolloverOptions): Promise<ReminderRolloverResult> {
  const empty: ReminderRolloverResult = { moved: 0, expired: 0, deduped: 0, daysCleared: [] }
  if (!options.autoRollover) return empty

  const { config, targetDay, expireDays } = options
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const targetFile = path.join(config.DIR_TIME, dayFile(targetDay))

  // Never modify a day that is already closed with a summary.
  if (await hasDaySummary(targetFile)) return empty

  const stateDir = path.join(config.DIR_STATE, 'reminders')
  const agesPath = path.join(stateDir, 'ages.json')
  const lockPath = path.join(stateDir, 'ages.lock')
  const recurringKeys = await loadRecurringReminderKeys(config.FILE_REMINDERS)

  return withProcessLock(lockPath, async () => {
    const ages = readFirstSeen(await readJson<ReminderAgesFile>(agesPath))
    let moved = 0
    let expired = 0
    let deduped = 0
    const daysCleared: string[] = []

    // Walk chronologically (oldest -> newest) so the earliest firstSeen wins naturally.
    for (let offset = lookbackDays; offset >= 1; offset--) {
      const from = targetDay.addDays(-offset)
      const sourceFile = path.join(config.DIR_TIME, dayFile(from))
      if (await hasDaySummary(sourceFile)) continue

      await withDayWrite(config, from.ymd, async () => {
        const source = await readOptional(sourceFile)
        if (source === undefined) return
        const section = planSection(source, REMINDERS_LIST)
        const rows = section?.rows.filter((row) => row.raw && DayDocument.isItemNotDone(row.raw)) ?? []
        if (!rows.length) return

        await withDayWrite(config, targetDay.ymd, async () => {
          const targetBefore = await readOptional(targetFile)
          let targetAfter = targetBefore ?? DayDocument.createFutureDay(targetDay).toMarkdown()
          const targetSeen = new Set<string>()
          for (const row of planSection(targetAfter, REMINDERS_LIST)?.rows ?? []) {
            if (row.raw && DayDocument.isItemNotDone(row.raw)) {
              const key = normalizeReminderKey(row.block)
              targetSeen.add(key)
              if (!ages[key]) ages[key] = targetDay.ymd
            }
          }

          let sourceAfter = source
          let targetMutated = false

          for (const row of rows) {
            const movedBlock = moveItemMarkdown(row.block, source, sourceFile, targetFile)
            const key = normalizeReminderKey(movedBlock)
            const titleKey = blockRaw(movedBlock)

            const recorded = ages[key]
            const firstSeen = recorded && recorded < from.ymd ? recorded : from.ymd
            const ageDays = daysBetween(new PlainDate(firstSeen), targetDay)
            const isRecurring = recurringKeys.has(titleKey)
            const limit = expireDays > 0 ? (isRecurring ? 1 : expireDays) : 0
            const isExpired = limit > 0 && ageDays >= limit

            if (isExpired) {
              expired++
            } else if (targetSeen.has(key)) {
              deduped++
              // Keep the earlier firstSeen when an identical item was already on targetDay.
              ages[key] = firstSeen
            } else {
              targetSeen.add(key)
              ages[key] = firstSeen
              targetAfter = appendTaskBlock(targetAfter, targetDay, REMINDERS_LIST, movedBlock, false)
              targetMutated = true
              moved++
            }

            // Consumed in source order, so occurrence 0 always targets this exact copy.
            sourceAfter = removeBlock(sourceAfter, REMINDERS_LIST, row.raw, 0)
          }

          const changes: Array<{ file: string; before: string | undefined; after: string }> = []
          if (targetMutated && targetAfter !== targetBefore) {
            changes.push({ file: targetFile, before: targetBefore, after: targetAfter })
          }
          changes.push({ file: sourceFile, before: source, after: sourceAfter })
          await writePlanningChanges(changes)
          daysCleared.push(from.ymd)
        })
      })
    }

    // Prune age entries to reminders currently alive on targetDay so completed/expired
    // items start fresh if re-added later.
    const nextFirstSeen: Record<string, string> = {}
    const targetCurrent = await readOptional(targetFile)
    if (targetCurrent !== undefined) {
      for (const row of planSection(targetCurrent, REMINDERS_LIST)?.rows ?? []) {
        if (!row.raw || !DayDocument.isItemNotDone(row.raw)) continue
        const key = normalizeReminderKey(row.block)
        nextFirstSeen[key] = ages[key] ?? targetDay.ymd
      }
    }
    await writeJson(agesPath, { version: AGES_VERSION, firstSeen: nextFirstSeen } satisfies ReminderAgesFile, 2)

    return { moved, expired, deduped, daysCleared }
  })
}
