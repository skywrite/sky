import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import * as path from 'node:path'

import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { createSupabaseClient, DayFileRow, getSupabaseEnv } from './lib/client.ts'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function extractStartedAt(content: string): string | null {
  try {
    const day = DayDocument.fromMarkdown(content)
    if (!day.started) return null
    return day.started.toTimeDateValue().toISOString()
  } catch {
    return null
  }
}

function isMissingStartedColumnError(error: { message?: string; details?: string }): boolean {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('column') && text.includes('started')
}

const params = {
  force: Flag.boolean('Force upload even if unchanged', { short: 'f', default: false }),
  days: Flag.number('Number of days to sync (default: 2)', { short: 'd', default: 2 }),
  date: Flag.string('Sync a specific date (YYYY-MM-DD)'),
  pushOnly: Flag.boolean('Only push local changes, do not pull', { default: false }),
  pullOnly: Flag.boolean('Only pull remote changes, do not push', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { synced: { date: string; action: string }[] }
const PAST_DAY_SKIP_ACTION = 'skipped (past day)'

export default class SyncSupabaseTask extends Command {
  static override description: CommandDescription = {
    name: 'supabase:sync',
    description: 'Sync today and tomorrow day files to/from Supabase',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const { force, days, date: specificDate, pushOnly, pullOnly } = args

    const envResult = getSupabaseEnv(env)
    if (!envResult.ok) {
      return envResult.result as CommandResult<Result>
    }
    const { userId } = envResult.env
    const supabase = createSupabaseClient(envResult.env)

    const results: { date: string; action: string }[] = []

    // Determine which dates to sync
    const datesToSync: PlainDate[] = []
    if (specificDate) {
      // Sync a specific date
      datesToSync.push(PlainDate.from(specificDate))
    } else {
      // Sync today + N days
      const today = PlainDate.today()
      for (let i = 0; i < days; i++) {
        datesToSync.push(today.addDays(i))
      }
    }

    for (const targetDate of datesToSync) {
      const ymd = targetDate.ymd

      try {
        const result = await this.syncDay(supabase, targetDate, userId, {
          force: force ?? false,
          pushOnly: pushOnly ?? false,
          pullOnly: pullOnly ?? false,
        })
        results.push({ date: ymd, action: result })
        output.log(`${ymd}: ${result}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        output.error(`${ymd}: Error - ${message}`)
        results.push({ date: ymd, action: `error: ${message}` })
      }
    }

    return CommandResult.success({ synced: results })
  }

  private async syncDay(
    supabase: SupabaseClient,
    date: PlainDate,
    userId: string,
    options: { force: boolean; pushOnly: boolean; pullOnly: boolean },
  ): Promise<string> {
    const filePath = dayFile(date)
    const fullPath = path.join(DIR_TIME, filePath)
    const ymd = date.ymd
    const currentNotebookDay = fetchNowSync().plainDateTime.plainDate
    const isPastDay = PlainDate.compare(date, currentNotebookDay) < 0

    // Check if local file exists
    const localExists = await exists(fullPath)
    const localContent = localExists ? await readTextFile(fullPath) : null
    const localHash = localContent ? sha256(localContent) : null
    const localStartedAt = localContent ? extractStartedAt(localContent) : null

    // Fetch remote state
    const { data: remote, error } = await supabase.from('day_files').select('*').eq('file_date', ymd).maybeSingle()

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`)
    }

    const remoteRow = remote as DayFileRow | null

    // Case 1: No local file, no remote - nothing to do
    if (!localContent && !remoteRow) {
      return 'no-file'
    }

    // Case 2: Local exists, no remote - push
    if (localContent && !remoteRow && !options.pullOnly) {
      if (isPastDay) {
        return PAST_DAY_SKIP_ACTION
      }
      await this.pushToSupabase(supabase, date, filePath, localContent, localHash!, localStartedAt, userId)
      return 'pushed (new)'
    }

    // Case 3: No local, remote exists - pull
    if (!localContent && remoteRow && !options.pushOnly) {
      await writeTextFile(fullPath, remoteRow.content)
      return 'pulled (new local)'
    }

    // Case 4: Both exist - compare and sync
    if (localContent && remoteRow) {
      const remoteHash = remoteRow.content_hash

      // Hashes match - no sync needed
      if (localHash === remoteHash && !options.force) {
        return 'up-to-date'
      }

      // Local changed, remote unchanged or force push
      if (!options.pullOnly && (options.force || remoteRow.synced_from === 'desktop')) {
        if (localHash !== remoteHash) {
          if (isPastDay) {
            return PAST_DAY_SKIP_ACTION
          }
          await this.pushToSupabase(supabase, date, filePath, localContent, localHash!, localStartedAt, userId)
          return 'pushed (updated)'
        }
      }

      // Remote changed by mobile - pull
      if (!options.pushOnly && remoteRow.synced_from === 'mobile' && localHash !== remoteHash) {
        // For now, simple overwrite. Future: merge logic
        await writeTextFile(fullPath, remoteRow.content)
        return 'pulled (mobile changes)'
      }

      // Force push if requested
      if (options.force && !options.pullOnly) {
        if (isPastDay) {
          return PAST_DAY_SKIP_ACTION
        }
        await this.pushToSupabase(supabase, date, filePath, localContent, localHash!, localStartedAt, userId)
        return 'pushed (forced)'
      }

      return 'up-to-date'
    }

    return 'no-action'
  }

  private async pushToSupabase(
    supabase: SupabaseClient,
    date: PlainDate,
    filePath: string,
    content: string,
    contentHash: string,
    startedAt: string | null,
    userId: string,
  ): Promise<void> {
    const basePayload = {
      user_id: userId,
      file_date: date.ymd,
      file_path: filePath,
      content: content,
      content_hash: contentHash,
      synced_from: 'desktop',
    }

    let { error } = await supabase.from('day_files').upsert(
      {
        ...basePayload,
        started: startedAt,
      },
      { onConflict: 'user_id,file_date' },
    )

    // Backward compatibility for environments where the column is not added yet.
    if (error && isMissingStartedColumnError(error)) {
      const retry = await supabase.from('day_files').upsert(basePayload, { onConflict: 'user_id,file_date' })
      error = retry.error
    }

    if (error) {
      throw new Error(`Failed to push: ${error.message}`)
    }
  }
}
