/**
 * Cross-session usage telemetry for the memory store — mined from the
 * CONTEXT-LOG every saved chat already carries, with zero new
 * instrumentation. A log's doc records name every document the context
 * pipeline shipped or cut per turn; counting the ai/memory/ paths that
 * SHIPPED (no `cut` reason) tells the consolidator which memories actually
 * reach conversations. Quiet turns (`reused`) list no docs, so counts
 * understate — evidence of shipping is what expiry decisions need, not an
 * exact tally.
 */

import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { type ContextDocRecord, splitContextLog } from '#shared/models/Chat/document/ContextLog/mod.ts'
import { dayAIChatsDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Log paths are notebook-relative — no leading slash, unlike MEMORY_PATH_SEGMENT. */
const LOG_PATH_SEGMENT = 'ai/memory/'

export interface MemoryUsage {
  /** Turn-records in which the memory shipped into context */
  ships: number
  /** Day (YYYY-MM-DD) of the most recent chat that shipped it */
  lastShipped?: string
}

export interface MemoryUsageReport {
  /** Per-slug usage over the window */
  usage: Map<string, MemoryUsage>
  /** Chats whose logs were read — 0 means no telemetry, not "nothing used" */
  chatsScanned: number
}

/**
 * Scan the last `days` days of saved chats for memory-doc ships. A day with
 * no chats folder contributes nothing; an unreadable chat is skipped — the
 * telemetry is advisory and must never fail a consolidation run.
 */
export async function gatherMemoryUsage(opts: {
  timeDir: string
  today: PlainDate
  days: number
}): Promise<MemoryUsageReport> {
  const usage = new Map<string, MemoryUsage>()
  let chatsScanned = 0

  for (let back = 0; back < opts.days; back++) {
    const day = opts.today.addDays(-back)
    const dir = path.join(opts.timeDir, dayAIChatsDir(day))
    for await (const entry of walk(dir, { includeDirs: false, exts: ['.md'] })) {
      try {
        const { entries } = splitContextLog(await readTextFile(entry.path))
        if (entries.length === 0) continue
        chatsScanned++
        for (const turn of entries) {
          countShipped(turn.universe, day.toString(), usage)
          countShipped(turn.diff, day.toString(), usage)
        }
      } catch {
        // Advisory telemetry: one unreadable chat never fails the run.
      }
    }
  }

  return { usage, chatsScanned }
}

function countShipped(records: ContextDocRecord[] | undefined, day: string, usage: Map<string, MemoryUsage>): void {
  if (!records) return
  for (const rec of records) {
    if (rec.cut || !rec.path.includes(LOG_PATH_SEGMENT)) continue
    const slug = rec.path.slice(rec.path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const prev = usage.get(slug)
    // Days scan newest-first, so the first ship seen is the latest.
    usage.set(slug, { ships: (prev?.ships ?? 0) + 1, lastShipped: prev?.lastShipped ?? day })
  }
}
