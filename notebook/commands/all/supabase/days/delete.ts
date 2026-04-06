import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { createSupabaseClient, getSupabaseEnv } from '../lib/client.ts'

const params = {
  from: Flag.string('Date or start date (YYYY-MM-DD)', { required: true }),
  to: Flag.string('End date (YYYY-MM-DD), inclusive. If omitted, deletes single day.'),
  dryRun: Flag.boolean('Show what would be deleted without deleting', {
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { deleted: number; dates: string[]; dryRun?: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'supabase:days:delete': { params: Params; result: Result }
  }
}

export default class DeleteDaysSupabaseTask extends Command {
  static override description: CommandDescription = {
    name: 'supabase:days:delete',
    description: 'Delete day(s) from Supabase (single date or range)',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const { from, to: toArg, dryRun } = args
    const to = toArg ?? from

    const envResult = getSupabaseEnv(env)
    if (!envResult.ok) {
      return envResult.result as CommandResult<Result>
    }
    const { userId } = envResult.env
    const supabase = createSupabaseClient(envResult.env)

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return CommandResult.fail(`Invalid from date format: ${from}. Expected YYYY-MM-DD`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return CommandResult.fail(`Invalid to date format: ${to}. Expected YYYY-MM-DD`)
    }

    // Validate range
    if (from > to) {
      return CommandResult.fail(`Invalid range: from (${from}) is after to (${to})`)
    }

    // First, query to see what would be deleted
    const { data: toDelete, error: queryError } = await supabase
      .from('day_files')
      .select('file_date')
      .eq('user_id', userId)
      .gte('file_date', from)
      .lte('file_date', to)
      .order('file_date', { ascending: true })

    if (queryError) {
      return CommandResult.fail(`Query failed: ${queryError.message}`)
    }

    const dates = (toDelete ?? []).map((r) => r.file_date as string)

    if (dates.length === 0) {
      output.log(`No days found in range ${from} to ${to}`)
      return CommandResult.success({ deleted: 0, dates: [] })
    }

    if (dryRun) {
      output.log(`Would delete ${dates.length} day(s):`)
      for (const date of dates) {
        output.log(`  ${date}`)
      }
      return CommandResult.success({ deleted: 0, dates, dryRun: true })
    }

    // Delete the range
    const { error: deleteError, count } = await supabase
      .from('day_files')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .gte('file_date', from)
      .lte('file_date', to)

    if (deleteError) {
      return CommandResult.fail(`Delete failed: ${deleteError.message}`)
    }

    const deleted = count ?? 0
    output.log(`Deleted ${deleted} day(s) from ${from} to ${to}:`)
    for (const date of dates) {
      output.log(`  ${date}`)
    }

    return CommandResult.success({ deleted, dates })
  }
}
