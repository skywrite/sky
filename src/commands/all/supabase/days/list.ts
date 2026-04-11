import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { createSupabaseClient, DayFileRow, getSupabaseEnv } from '../lib/client.ts'

const params = {
  json: Flag.boolean('Output as JSON', { default: false }),
  limit: Flag.number('Limit number of results'),
}

type Params = InferParams<typeof params>
type Result = { count: number; days: string[] }

function isMissingStartedColumnError(error: { message?: string; details?: string }): boolean {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('column') && text.includes('started')
}

export default class ListDaysSupabaseTask extends Command {
  static override description: CommandDescription = {
    name: 'supabase:days:list',
    description: 'List all days stored in Supabase for the current user',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const { json, limit } = args

    const envResult = getSupabaseEnv(env)
    if (!envResult.ok) {
      return envResult.result as CommandResult<Result>
    }
    const { userId } = envResult.env
    const supabase = createSupabaseClient(envResult.env)

    // Query all days for the user.
    // Fallback to legacy projection if the "started" column does not exist yet.
    let includeStarted = true
    let query = supabase
      .from('day_files')
      .select('file_date, started, file_path, content_hash, updated_at, synced_from')
      .eq('user_id', userId)
      .order('file_date', { ascending: false })

    if (limit) {
      query = query.limit(limit)
    }

    const startedResult = await query
    let data = startedResult.data as DayFileRow[] | null
    let error = startedResult.error

    if (error && isMissingStartedColumnError(error)) {
      includeStarted = false
      let legacyQuery = supabase
        .from('day_files')
        .select('file_date, file_path, content_hash, updated_at, synced_from')
        .eq('user_id', userId)
        .order('file_date', { ascending: false })

      if (limit) {
        legacyQuery = legacyQuery.limit(limit)
      }

      const legacyResult = await legacyQuery
      data = legacyResult.data as DayFileRow[] | null
      error = legacyResult.error
    }

    if (error) {
      return CommandResult.fail(`Supabase query failed: ${error.message}`)
    }

    const rows = (data ?? []) as DayFileRow[]

    if (json) {
      output.log(JSON.stringify(rows, null, 2))
    } else {
      output.log(`Found ${rows.length} day(s) in Supabase for user ${userId}:\n`)

      for (const row of rows) {
        const syncedFrom = row.synced_from ? ` (synced from: ${row.synced_from})` : ''
        const started = includeStarted && row.started ? ` started=${row.started}` : ''
        output.log(`  ${row.file_date}${syncedFrom}${started}`)
      }
    }

    return CommandResult.success({ count: rows.length, days: rows.map((r) => r.file_date) })
  }
}
