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
import { type ExecuteResult, executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import { dropInvalidSelections } from '#shared/models/DomainCollection/query/normalize.ts'
import { selectorToGraphQL } from '#shared/models/DomainCollection/query/transpiler.ts'
import { parseSelector } from '#shared/models/DomainCollection/query/parser.ts'
import { PORT_SERVER } from '#shared/config.ts'
import { AI_ERROR_LOG_DISPLAY, logAIError } from '#shared/ai/errorLog.ts'

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

// A service restart unbinds :9999 for up to ~70s: launchd takes 20-45s to
// respawn the process, then the notebook rescan takes ~24s before the port
// binds. Every context query fired in that window used to fail hard. Spread
// ~90s of retries across it; after one query exhausts them the service is
// down rather than restarting, so later queries in the same process fail
// fast instead of stacking retry waits. Any success re-arms.
const CONNECT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]
let connectRetriesExhausted = false

async function fetchGraphQL(url: string, query: string, output: CommandArgs['context']['output']): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      connectRetriesExhausted = false
      return response
    } catch (err) {
      if (connectRetriesExhausted || attempt >= CONNECT_RETRY_DELAYS_MS.length) {
        connectRetriesExhausted = true
        throw err
      }
      const delayMs = CONNECT_RETRY_DELAYS_MS[attempt]
      output.log(colors.dim(`Service unreachable — retrying in ${delayMs / 1000}s...`))
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
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

    let response: Response
    try {
      response = await fetchGraphQL(url, query, output)
    } catch (err) {
      // markdown:sel is the execution layer for all AI-generated queries
      // (ai:context:files/evolve → here), and the only spot holding both the
      // query and its errors — so AI-pipeline failures are logged from here.
      const message = `Service unreachable at ${url}: ${(err as Error).message}`
      output.log(colors.red(message))
      await logAIError({ source: 'markdown:sel', stage: 'query:server', message, query })
      return CommandResult.fail(message)
    }

    if (!response.ok) {
      const message = `Server error: ${response.status} ${response.statusText}`
      output.log(colors.red(message))
      await logAIError({ source: 'markdown:sel', stage: 'query:server', message, query })
      return CommandResult.fail(`Server error: ${response.status}`)
    }

    let result = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> }

    if (result.errors?.length) {
      // One invalid selection fails the whole document at validation, so
      // drop the invalid selections and execute the remainder — partial
      // context beats none. Falls through to the failure path when the
      // errors cannot be pinned to selections or the whole query is bad.
      const partial = await this.retrySalvagedViaServer(query, result.errors, url, output)
      if (partial) {
        result = partial
      } else {
        for (const err of result.errors) {
          output.log(colors.red(`GraphQL Error: ${err.message}`))
        }
        output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
        await logAIError({
          source: 'markdown:sel',
          stage: 'query:server',
          message: 'GraphQL query failed',
          query,
          errors: result.errors.map((e) => e.message),
        })
        return CommandResult.fail('GraphQL query failed')
      }
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

    let result = await executeQuery(query, store)

    if (result.errors?.length) {
      // Same salvage as the server path: execute the valid remainder
      // rather than losing every selection to one invalid one.
      const partial = await this.retrySalvagedLocally(query, result.errors, store, output)
      if (partial) {
        result = partial
      } else {
        for (const err of result.errors) {
          output.log(colors.red(`GraphQL Error: ${err.message}`))
        }
        output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
        await logAIError({
          source: 'markdown:sel',
          stage: 'query:local',
          message: 'GraphQL query failed',
          query,
          errors: result.errors.map((e) => e.message),
        })
        return CommandResult.fail('GraphQL query failed')
      }
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

  /**
   * Execute the salvageable remainder of a validation-rejected query via
   * the server. Returns the remainder's result, or null when nothing was
   * salvaged or the remainder failed too — callers then take the normal
   * failure path with the original errors.
   */
  private async retrySalvagedViaServer(
    query: string,
    errors: Array<{ message: string }>,
    url: string,
    output: CommandArgs['context']['output'],
  ): Promise<{ data?: unknown; errors?: Array<{ message: string }> } | null> {
    const salvaged = await dropInvalidSelections(query)
    if (!salvaged || salvaged.dropped.length === 0) return null

    let response: Response
    try {
      response = await fetchGraphQL(url, salvaged.query, output)
    } catch {
      return null
    }
    if (!response.ok) return null

    const result = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> }
    if (result.errors?.length) return null

    await this.reportSalvage(
      salvaged.dropped.map((d) => d.key),
      query,
      errors,
      'query:server',
      output,
    )
    return result
  }

  /** Local-store counterpart of retrySalvagedViaServer. */
  private async retrySalvagedLocally(
    query: string,
    errors: Array<{ message: string }>,
    store: MarkdownStore,
    output: CommandArgs['context']['output'],
  ): Promise<ExecuteResult | null> {
    const salvaged = await dropInvalidSelections(query)
    if (!salvaged || salvaged.dropped.length === 0) return null

    const result = await executeQuery(salvaged.query, store)
    if (result.errors?.length) return null

    await this.reportSalvage(
      salvaged.dropped.map((d) => d.key),
      query,
      errors,
      'query:local',
      output,
    )
    return result
  }

  private async reportSalvage(
    droppedKeys: string[],
    query: string,
    errors: Array<{ message: string }>,
    stage: 'query:server' | 'query:local',
    output: CommandArgs['context']['output'],
  ): Promise<void> {
    const keys = droppedKeys.join(', ')
    output.log(colors.yellow(`Dropped invalid selection(s): ${keys} — returning partial results`))
    output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
    await logAIError({
      source: 'markdown:sel',
      stage,
      message: `Salvaged partial results (dropped: ${keys})`,
      query,
      errors: errors.map((e) => e.message),
    })
  }
}
