import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { columnName, quoteCsv } from '#commands/all/track/lib/csv.ts'
import { readTrackingRange } from '#commands/all/track/lib/read.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  type: Flag.string('Tracking slug or category/slug', { short: 't', default: () => 'health/weight' }),
}

type Params = InferParams<typeof params>
type Result = { totalRecords: number }

export default class DataTrackingTask extends Command {
  static override description: CommandDescription = {
    name: 'data:tracking',
    description: 'Output dated tracking data from annual or legacy weekly files.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const parts = args.type.split('/')
    if (parts.length > 2 || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) {
      return CommandResult.fail('Expected a tracking slug or category/slug')
    }
    const name = parts.at(-1)!
    const category = parts.length === 2 ? parts[0] : 'health'
    const dirs = { timeDir: config.DIR_TIME as string, dataTrackingDir: config.DIR_DATA_TRACKING as string }
    const years: number[] = []
    for (const dir of [dirs.timeDir, dirs.dataTrackingDir]) {
      if (await exists(dir)) years.push(...(await readdir(dir)).filter((name) => /^\d{4}$/.test(name)).map(Number))
    }
    if (!years.length) return CommandResult.success({ totalRecords: 0 })
    const sources = await readTrackingRange(
      dirs,
      name,
      new PlainDate(Math.min(...years), 1, 1),
      new PlainDate(Math.max(...years), 12, 31),
      category,
    )
    const records = sources.flatMap((source) =>
      source.rows.map((row) => Object.fromEntries(source.header.map((h, i) => [columnName(h), row[i] ?? '']))),
    )
    records.sort((a, b) => a.date.localeCompare(b.date))
    // Preserve the established weight export's date,lbs contract.
    const columns = name === 'weight' ? ['date', 'lbs'] : [...new Set(sources.flatMap((s) => s.header.map(columnName)))]
    if (columns.length) output.log(columns.join(','))
    let totalRecords = 0
    for (const record of records) {
      if (name === 'weight' && (!record.lbs || record.lbs === '-')) continue
      output.log(
        columns.map((c) => (/[,"\n]/.test(record[c] ?? '') ? quoteCsv(record[c]) : (record[c] ?? ''))).join(','),
      )
      totalRecords++
    }
    return CommandResult.success({ totalRecords })
  }
}
