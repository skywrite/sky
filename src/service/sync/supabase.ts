/**
 * Supabase sync functionality for day files.
 *
 * Handles:
 * - Pushing local day file changes to Supabase (debounced)
 * - Subscribing to mobile changes and pulling them locally
 */

import { createClient } from '@supabase/supabase-js'
import { readTextFile } from '#shared/fs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as config from '#shared/config.ts'

// Debounce state for Supabase sync (per-date to handle multiple files)
const syncTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
const SYNC_DEBOUNCE_MS = 3000 // 3 seconds after last change

/**
 * Check if a file path is a day file.
 */
export function isDayFile(filePath: string, timeDir: string): boolean {
  return filePath.includes(timeDir) && filePath.endsWith('day.md')
}

/**
 * Check if day file has "ended" set (day is finished).
 */
async function isDayEnded(filePath: string): Promise<boolean> {
  try {
    const content = await readTextFile(filePath)
    const day = DayDocument.fromMarkdown(content)
    return day.ended !== undefined
  } catch {
    return false
  }
}

/**
 * Schedule a day file sync to Supabase (debounced).
 *
 * Multiple rapid changes to the same day will be batched into a single sync
 * after SYNC_DEBOUNCE_MS milliseconds of inactivity.
 */
export function scheduleDayFileSync(filePath: string, cfg: typeof config): void {
  let date: string
  try {
    date = parseDateFromDayPath(filePath).ymd
  } catch (err) {
    console.error(`[daySync] Could not extract date from path: ${filePath}`, err)
    return
  }

  // Clear any existing timeout for this date (debounce)
  const existingTimeout = syncTimeouts.get(date)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
    console.debug(`[daySync] Debounce reset for ${date}`)
  }

  console.log(`[daySync] Change detected for ${date}, syncing in ${SYNC_DEBOUNCE_MS}ms...`)

  syncTimeouts.set(
    date,
    setTimeout(async () => {
      syncTimeouts.delete(date)

      // Check if day has ended - don't sync finished days
      if (await isDayEnded(filePath)) {
        console.log(`[daySync] Skipping ${date} (day has ended)`)
        return
      }

      console.log(`[daySync] Pushing ${date} to Supabase...`)
      try {
        const context = CommandContext.server(cfg, env.toObject())
        const tasks = new CommandService(context)
        const result = await tasks.run('supabase:sync', { pushOnly: true, date })
        if (result.status === 'success') {
          const syncData = result.data as { synced?: { date: string; action: string }[] }
          const action = syncData?.synced?.[0]?.action ?? 'unknown'
          console.log(`[daySync] ${date}: ${action}`)
        } else {
          console.error(`[daySync] ${date} failed: ${result.message}`)
        }
      } catch (err) {
        console.error(`[daySync] ${date} error:`, err)
      }
    }, SYNC_DEBOUNCE_MS),
  )
}

/**
 * Subscribe to Supabase realtime for mobile changes.
 *
 * When a day file is updated from mobile, this will automatically
 * pull the changes to the local filesystem.
 */
export function subscribeToMobileChanges(cfg: typeof config): void {
  const projectUrl = env.get('SUPABASE_PROJECT_URL')
  const secretKey = env.get('SUPABASE_SECRET_KEY')

  if (!projectUrl || !secretKey) {
    console.warn('[mobilePull] Supabase not configured, skipping realtime subscription')
    return
  }

  const supabase = createClient(projectUrl, secretKey)

  supabase
    .channel('day_files_mobile')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'day_files',
        filter: 'synced_from=eq.mobile',
      },
      async (payload) => {
        const date = payload.new?.file_date as string | undefined
        if (!date) return

        console.log(`[mobilePull] Mobile change detected for ${date}, pulling...`)
        try {
          const context = CommandContext.server(cfg, env.toObject())
          const tasks = new CommandService(context)
          const result = await tasks.run('supabase:sync', { pullOnly: true, date })
          if (result.status === 'success') {
            const syncData = result.data as { synced?: { date: string; action: string }[] }
            const action = syncData?.synced?.[0]?.action ?? 'unknown'
            console.log(`[mobilePull] ${date}: ${action}`)
          } else {
            console.error(`[mobilePull] ${date} failed: ${result.message}`)
          }
        } catch (err) {
          console.error(`[mobilePull] ${date} error:`, err)
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[mobilePull] Subscribed to Supabase realtime for mobile changes')
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[mobilePull] Failed to subscribe to Supabase realtime')
      }
    })
}
