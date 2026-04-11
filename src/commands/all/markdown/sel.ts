/**
 * Query documents using CSS-like selectors or GraphQL.
 *
 * Usage:
 *   skymarkdown:sel --dsl "meeting:recent(7d)"
 *   skymarkdown:sel --graphql '{ meetings(where: { recent: "7d" }) { path } }'
 *   skymarkdown:sel --graphql '{ meetings { path } }' --server
 */

import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import { selectorToGraphQL } from '#shared/models/DomainCollection/query/transpiler.ts'
import { parseSelector } from '#shared/models/DomainCollection/query/parser.ts'
import { PORT_SERVER } from '#shared/config.ts'

const params = {
  dsl: Flag.string('CSS-like selector query', { short: 'd', optional: true }),
  graphql: Flag.string('GraphQL query', { short: 'g', optional: true }),
  server: Flag.string('Server URL (default: localhost:9999). Use without value for default, or pass host:port', {
    short: 'S',
  }),
  raw: Flag.boolean('Output just file paths, one per line', { default: false }),
  json: Flag.boolean('Output full JSON result (for GraphQL)', { default: false }),
  limit: Flag.number('Limit number of results', { optional: true }),
}

type Params = InferParams<typeof params>

interface QueryResult {
  paths: string[]
  count: number
  data?: unknown
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'markdown:sel': { params: Params; result: QueryResult }
  }
}

/**
 * Resolve --server value to a full GraphQL URL.
 */
function resolveServerUrl(server: string): string {
  // Bare --server flag (mri gives true, zod coerces to "true")
  if (server === 'true' || server === '') {
    return `http://localhost:${PORT_SERVER}/graphql`
  }
  const url = new URL('/graphql', server.startsWith('http') ? server : `http://${server}`)
  return url.href
}

function shortenPath(fullPath: string, baseDir: string): string {
  if (baseDir && fullPath.startsWith(baseDir)) {
    return fullPath.slice(baseDir.length + 1)
  }
  return fullPath
}

/**
 * Extract paths from GraphQL result data.
 * Looks for 'path' fields in arrays at any level.
 */
function extractPaths(data: unknown): string[] {
  const paths: string[] = []

  function walk(obj: unknown) {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item)
      }
    } else if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      if (typeof record.path === 'string') {
        paths.push(record.path)
      }
      for (const value of Object.values(record)) {
        walk(value)
      }
    }
  }

  walk(data)
  return paths
}

export default class MarkdownSelectorTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:sel',
    description: 'Query documents using CSS-like selectors or GraphQL',
    descriptionLong: [
      'Query notebook documents using CSS-inspired selector syntax or GraphQL.',
      '',
      'Use --dsl for CSS-like selectors:',
      '  type[attr="value"]:pseudo(arg)',
      '',
      'Types: meeting, message, person, org, project, decision, goal, day, *',
      'Operators: = (exact), ~= (contains), ^= (starts), $= (ends)',
      'Pseudos: :today, :yesterday, :recent(7d), :pending, :involves("name")',
      '',
      'Use --graphql for GraphQL queries:',
      '  { meetings(where: { recent: "7d" }) { who summary path } }',
      '  { people(where: { org: "MoonPay" }) { name title path } }',
      '',
      'Resolution:',
      '  By default, builds MarkdownStore locally (slower startup, no server needed).',
      '  Use --server to query the running notebook service (faster, requires service).',
    ],
    usage: [
      'sky markdown:sel --dsl "meeting:recent(7d)"',
      'sky markdown:sel --dsl "person[org=MoonPay]"',
      'sky markdown:sel --dsl "decision:pending" --raw',
      'sky markdown:sel --graphql \'{ meetings(where: { recent: "7d" }) { who path } }\'',
      'sky markdown:sel --graphql \'{ people(where: { org: "MoonPay" }) { name } }\' --json',
      "sky markdown:sel --graphql '{ decisions { name } }' --server",
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<QueryResult>> {
    const { config, output } = context
    const { dsl, graphql, server, raw, json, limit } = args
    const baseDir = config.DIR_BASE as string

    // Validate: exactly one of --dsl or --graphql must be provided
    if (!dsl && !graphql) {
      output.log(colors.red('Error: Either --dsl or --graphql is required'))
      return CommandResult.fail('Either --dsl or --graphql is required')
    }
    if (dsl && graphql) {
      output.log(colors.red('Error: Cannot use both --dsl and --graphql'))
      return CommandResult.fail('Cannot use both --dsl and --graphql')
    }
    // --server: send query directly to the running service
    if (server) {
      const url = resolveServerUrl(server)
      const query = dsl ? selectorToGraphQL(dsl).query : graphql!
      return this.executeGraphQLViaServer(query, url, { raw, json, limit, baseDir, context })
    }

    // Build store locally
    const store = await this.buildStore()
    if (!store) {
      return CommandResult.fail('Failed to build store')
    }

    // Execute the appropriate query type
    if (graphql) {
      return this.executeGraphQL(graphql, store, { raw, json, limit, baseDir, context })
    } else {
      return this.executeSelector(dsl!, store, { raw, limit, baseDir, context })
    }
  }

  private async buildStore(): Promise<MarkdownStore | null> {
    return MarkdownStore.buildFromAll()
  }

  private async executeGraphQLViaServer(
    query: string,
    url: string,
    opts: { raw: boolean; json: boolean; limit?: number; baseDir: string; context: CommandArgs['context'] },
  ): Promise<CommandResult<QueryResult>> {
    const { raw, json, limit, baseDir, context } = opts
    const { output } = context

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      output.log(colors.red(`Server error: ${response.status} ${response.statusText}`))
      return CommandResult.fail(`Server error: ${response.status}`)
    }

    const result = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> }

    if (result.errors?.length) {
      for (const err of result.errors) {
        output.log(colors.red(`GraphQL Error: ${err.message}`))
      }
      return CommandResult.fail('GraphQL query failed')
    }

    let paths = extractPaths(result.data)
    if (limit) {
      paths = paths.slice(0, limit)
    }

    if (context.compositionDepth === 0) {
      if (json) {
        output.log(JSON.stringify(result.data, null, 2))
      } else if (raw) {
        for (const p of paths) {
          output.log(shortenPath(p, baseDir))
        }
      } else {
        const countText = paths.length === 1 ? 'match' : 'matches'
        output.log(colors.green(`✓ ${paths.length} ${countText}\n`))

        for (let i = 0; i < paths.length; i++) {
          output.log(`${colors.gray(`${String(i + 1).padStart(3, ' ')}.`)} ${shortenPath(paths[i], baseDir)}`)
        }
      }
    }

    return CommandResult.success({ paths, count: paths.length, data: result.data })
  }

  private async executeGraphQL(
    query: string,
    store: MarkdownStore,
    opts: { raw: boolean; json: boolean; limit?: number; baseDir: string; context: CommandArgs['context'] },
  ): Promise<CommandResult<QueryResult>> {
    const { raw, json, limit, baseDir, context } = opts
    const { output } = context

    const result = await executeQuery(query, store)

    if (result.errors?.length) {
      for (const err of result.errors) {
        output.log(colors.red(`GraphQL Error: ${err.message}`))
      }
      return CommandResult.fail('GraphQL query failed')
    }

    // Extract paths from result
    let paths = extractPaths(result.data)
    if (limit) {
      paths = paths.slice(0, limit)
    }

    // Only print results when run directly from CLI
    if (context.compositionDepth === 0) {
      if (json) {
        output.log(JSON.stringify(result.data, null, 2))
      } else if (raw) {
        for (const p of paths) {
          output.log(shortenPath(p, baseDir))
        }
      } else {
        const countText = paths.length === 1 ? 'match' : 'matches'
        output.log(colors.green(`✓ ${paths.length} ${countText}\n`))

        for (let i = 0; i < paths.length; i++) {
          output.log(`${colors.gray(`${String(i + 1).padStart(3, ' ')}.`)} ${shortenPath(paths[i], baseDir)}`)
        }
      }
    }

    return CommandResult.success({ paths, count: paths.length, data: result.data })
  }

  private async executeSelector(
    selector: string,
    store: MarkdownStore,
    opts: { raw: boolean; limit?: number; baseDir: string; context: CommandArgs['context'] },
  ): Promise<CommandResult<QueryResult>> {
    const { context } = opts
    const { output } = context

    // Validate selector syntax
    try {
      parseSelector(selector)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      output.log(colors.red(`Invalid selector: ${msg}`))
      return CommandResult.fail(`Invalid selector: ${msg}`)
    }

    // Transpile DSL → GraphQL, then execute via the GraphQL path
    const { query } = selectorToGraphQL(selector)
    return this.executeGraphQL(query, store, { ...opts, json: false })
  }
}
