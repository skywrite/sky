/**
 * AI Context Files - Returns file paths matching an AI-generated query.
 *
 * Flow:
 *   1. ai:context:date extracts timeframe from question (when --since auto)
 *   2. ai:context:sel generates GraphQL query from question
 *   3. markdown:sel executes query and returns paths
 *
 * Usage: sky ai:context:files "What did I discuss with Alice last week?"
 */

import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import type { QueryTruncation } from '#shared/models/DomainCollection/query/resolvers/shared.ts'

// -----------------------------------------------------------------------------
// Params
// -----------------------------------------------------------------------------

const params = {
  question: Arg.string('Question to find relevant files for'),
  since: Flag.string('Only include time-based docs from this period (e.g., 1y, 6mo, 90d, auto)', {
    short: 's',
    default: () => 'auto',
  }),
  server: Flag.bool('Use the running notebook service instead of building MarkdownStore locally', {
    short: 'S',
    default: false,
  }),
  raw: Flag.bool('Output just file paths, one per line', { default: false }),
  json: Flag.bool('Output as JSON', { default: false }),
  limit: Flag.number('Limit number of results', { optional: true }),
}

type Params = InferParams<typeof params>

interface FilesResult {
  question: string
  query: string
  paths: string[]
  count: number
  /** Root fields whose result hit a cap during execution. */
  truncations?: QueryTruncation[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:files': { params: Params; result: FilesResult }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AIContextFilesTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:context:files',
    description: 'AI generates query and returns matching file paths',
    descriptionLong: [
      'Returns file paths matching an AI-generated query:',
      '1. AI generates a GraphQL query based on the question',
      '2. Query is executed against the notebook documents',
      '3. File paths are returned',
      '',
      'Use --since to limit time-based results (meetings, messages, journals).',
      'Default is "auto" — AI extracts a timeframe from the question; when the',
      'question names none, all history is searched (results are newest-first',
      'and capped by limit, so this costs nothing).',
      'Use --since all to disable, or an explicit value like 1y, 90d.',
    ],
    usage: [
      'sky ai:context:files "What did I discuss with Alice last week?"',
      'sky ai:context:files "What should I do about Jane?" --since 18mo',
      'sky ai:context:files "What are my pending decisions?" --raw',
      'sky ai:context:files "Show me everything about Acme" --since all',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<FilesResult>> {
    const { config, output } = context
    const { question, since, server, raw, json, limit } = args
    const baseDir = config.DIR_BASE as string

    // Step 1: Resolve timeframe. No extracted timeframe means no `recent`
    // filter at all — results are newest-first and capped by limit, so
    // searching all history costs nothing and reaches sparse older topics.
    let resolvedSince: string | undefined = since
    if (since === 'auto') {
      resolvedSince = undefined
      try {
        const dateResult = await tasks.run<{ since: string; dates: string[] }>('ai:context:date', {
          _: ['ai:context:date', question],
        })
        if (dateResult.status === 'success') {
          resolvedSince = dateResult.data?.since || undefined
        }
      } catch {
        resolvedSince = undefined
      }
      output.log(colors.dim(`Timeframe: ${resolvedSince ?? 'all history (default)'}`))
    }

    // Step 2: Generate GraphQL query using AI
    output.log(colors.dim('Generating query...'))

    const selResult = await tasks.run<{ query: string }>('ai:context:sel', {
      _: ['ai:context:sel', question],
      since: resolvedSince === 'all' ? undefined : resolvedSince,
    })

    if (selResult.status !== 'success' || !selResult.data?.query) {
      output.log(colors.red('Failed to generate query'))
      return CommandResult.fail('Failed to generate query')
    }

    const query = selResult.data.query
    output.log(colors.dim(`Query: ${query.slice(0, 80)}${query.length > 80 ? '...' : ''}`))

    // Step 3: Execute query using markdown:sel
    output.log(colors.dim('Executing query...'))

    const execResult = await tasks.run('markdown:sel', {
      graphql: query,
      raw: true, // Suppress formatted output from markdown:sel
      limit,
      server,
    })

    if (execResult.status !== 'success') {
      output.log(colors.red('Failed to execute query'))
      return CommandResult.fail('Failed to execute query')
    }

    const { paths, count } = execResult.data ?? { paths: [], count: 0 }
    const truncations = execResult.data?.truncations ?? []
    // Composed under ai:chat, markdown:sel prints nothing — surface capped
    // results here so a truncated gather is never mistaken for a complete one.
    for (const t of truncations) {
      const cap = t.defaulted ? `default cap ${t.limit}` : `limit ${t.limit}`
      output.log(colors.yellow(`⚠ ${t.field}: ${t.matched} matched, ${t.returned} returned — ${cap} hit, rest dropped`))
    }

    // Step 4: Format output
    if (json) {
      output.log(JSON.stringify({ question, query, paths, count }, null, 2))
    } else if (raw) {
      for (const p of paths) {
        output.log(shortenPath(p, baseDir))
      }
    } else {
      if (count === 0) {
        output.log(colors.yellow('No files found matching the query'))
      } else {
        output.log('')
        output.log(colors.green(`✓ Found ${count} file${count === 1 ? '' : 's'} for: "${question}"`))
        output.log(colors.dim(`  Query: ${query.slice(0, 60)}${query.length > 60 ? '...' : ''}`))
        output.log('')

        for (let i = 0; i < paths.length; i++) {
          output.log(`${colors.gray(`${String(i + 1).padStart(3, ' ')}.`)} ${shortenPath(paths[i], baseDir)}`)
        }
      }
    }

    return CommandResult.success({
      question,
      query,
      paths,
      count,
      ...(truncations.length > 0 ? { truncations } : {}),
    })
  }
}

function shortenPath(fullPath: string, baseDir: string): string {
  if (baseDir && fullPath.startsWith(baseDir)) {
    return fullPath.slice(baseDir.length + 1)
  }
  return fullPath
}
