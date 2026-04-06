import colors from 'picocolors'
import * as config from '#config'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  days: Flag.number('Number of days to look back (default: 7)', {
    short: 'd',
    default: 7,
  }),
  since: Flag.string('Show people created since this date (partial date format: 27, 1-27, 2026-01-27)', {
    short: 's',
    optional: true,
  }),
}

type Params = InferParams<typeof params>

interface PersonInfo {
  name: string
  org: string | null
  met: string | null
  created: string
  filePath: string
}

type Result = { people: PersonInfo[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'person:list:last': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class PeopleListLastTask extends Command {
  static override description: CommandDescription = {
    name: 'person:list:last',
    description: 'List recently created people.',
    descriptionLong: [
      'Lists people created within a specified time period.',
      'By default shows people created in the last 7 days.',
      'Use --days to change the lookback period or --since for a specific date.',
    ],
    usage: [
      'sky person:list:last                   # People created in last 7 days',
      'sky person:list:last --days 30         # People created in last 30 days',
      'sky person:list:last --since 15        # People created since the 15th',
      'sky person:list:last --since 2026-01   # People created since January 2026',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { days, since } = args

    // Determine the cutoff date
    let cutoffDate: PlainDate
    if (since) {
      cutoffDate = parsePartialDate(since)
    } else {
      cutoffDate = PlainDate.today().addDays(-days)
    }

    const cutoffYmd = cutoffDate.ymd

    // Load people from both directories
    const peopleDirs = [<string>config.DIR_PEOPLE, <string>config.DIR_PEOPLE_OLD]
    const store = await PeopleStore.build(peopleDirs)

    const people: PersonInfo[] = []

    // Get all people and filter by created date
    for (const item of store.getAll()) {
      const person = item.doc
      const created = person.created
      if (!created) continue

      // Filter: only include people created on or after cutoff date
      if (created.ymd < cutoffYmd) continue

      // Extract met date string
      let metStr: string | null = null
      const met = person.met
      if (met) {
        metStr = 'ymd' in met ? met.ymd : met.toString()
      }

      people.push({
        name: person.name,
        org: person.org ?? null,
        met: metStr,
        created: created.ymd,
        filePath: item.path,
      })
    }

    // Sort by created date (most recent first)
    people.sort((a, b) => b.created.localeCompare(a.created))

    if (people.length === 0) {
      output.log(`No people created since ${cutoffYmd}.`)
      return CommandResult.success({ people: [] })
    }

    // Calculate column widths
    const cols = {
      name: 'Name'.length,
      org: 'Org'.length,
      met: 'Met'.length,
      created: 'Created'.length,
    }

    for (const p of people) {
      cols.name = Math.max(cols.name, p.name.length)
      cols.org = Math.max(cols.org, (p.org ?? '-').length)
      cols.met = Math.max(cols.met, (p.met ?? '-').length)
      cols.created = Math.max(cols.created, p.created.length)
    }

    // Header
    const header = [
      'Created'.padEnd(cols.created),
      'Name'.padEnd(cols.name),
      'Org'.padEnd(cols.org),
      'Met'.padEnd(cols.met),
    ].join('  ')

    const separator = [
      '-'.repeat(cols.created),
      '-'.repeat(cols.name),
      '-'.repeat(cols.org),
      '-'.repeat(cols.met),
    ].join('  ')

    output.log(colors.dim(`People created since ${cutoffYmd}:`))
    output.log('')
    output.log(header)
    output.log(separator)

    // Rows
    for (const p of people) {
      const row = [
        p.created.padEnd(cols.created),
        p.name.padEnd(cols.name),
        (p.org ?? '-').padEnd(cols.org),
        (p.met ?? '-').padEnd(cols.met),
      ].join('  ')
      output.log(row)
    }

    output.log('')
    output.log(colors.dim(`${people.length} people total`))

    return CommandResult.success({ people })
  }
}
