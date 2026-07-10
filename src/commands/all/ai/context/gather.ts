/**
 * AI Context Gatherer - Orchestrates AI query generation and execution.
 *
 * Flow:
 *   1. ai:context:sel generates GraphQL query from question
 *   2. markdown:sel executes query against MarkdownStore
 *   3. Results loaded into DomainCollection
 *   4. Returns context as markdown or structured data
 *
 * Usage: sky ai:context:gather "What did I discuss with Alice last week?"
 */

import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'

// -----------------------------------------------------------------------------
// Params
// -----------------------------------------------------------------------------

const params = {
  question: Arg.string('Question to gather context for'),
  raw: Flag.boolean('Output raw markdown without formatting', { default: false }),
  json: Flag.boolean('Output as JSON', { default: false }),
  depth: Flag.number('Entity resolution depth', { default: () => Infinity }),
}

type Params = InferParams<typeof params>

interface GatherResult {
  question: string
  query: string
  paths: string[]
  count: number
  markdown?: string
  data?: unknown
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:gather': { params: Params; result: GatherResult }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AIContextGatherTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:context:gather',
    description: 'AI generates query and gathers context for a question',
    descriptionLong: [
      'Orchestrates the full context gathering flow:',
      '1. AI generates a GraphQL query based on the question',
      '2. Query is executed against the notebook documents',
      '3. Results are loaded into DomainCollection with entity resolution',
      '4. Context is returned as markdown or structured data',
      '',
      'This is the high-level task for AI-driven context gathering.',
    ],
    usage: [
      'sky ai:context:gather "What did I discuss with Alice last week?"',
      'sky ai:context:gather "What are my pending decisions?" --json',
      'sky ai:context:gather "Show me Acme project context" --raw',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<GatherResult>> {
    const { config, output } = context
    const { question, raw, json, depth } = args

    // Step 1: Generate GraphQL query using AI
    output.log(colors.dim('Generating query...'))

    const selResult = await tasks.run<{ query: string }>('ai:context:sel', {
      _: ['ai:context:sel', question], // positional arg
    })

    if (selResult.status !== 'success' || !selResult.data?.query) {
      output.log(colors.red('Failed to generate query'))
      return CommandResult.fail('Failed to generate query')
    }

    const query = selResult.data.query
    output.log(colors.dim(`Query: ${query.slice(0, 80)}${query.length > 80 ? '...' : ''}`))

    // Step 2: Execute query using markdown:sel
    output.log(colors.dim('Executing query...'))

    const execResult = await tasks.run('markdown:sel', {
      graphql: query,
      json: true, // Always get full data for DomainCollection
    })

    if (execResult.status !== 'success') {
      output.log(colors.red('Failed to execute query'))
      return CommandResult.fail('Failed to execute query')
    }

    const { paths, count, data } = execResult.data ?? { paths: [], count: 0 }

    if (count === 0) {
      output.log(colors.yellow('No documents found matching the query'))
      return CommandResult.success({
        question,
        query,
        paths: [],
        count: 0,
        markdown: '(No matching documents found)',
      })
    }

    output.log(colors.dim(`Found ${count} document${count === 1 ? '' : 's'}`))

    // Step 3: Load documents into DomainCollection
    const store = await MarkdownStore.buildFromAll()

    // Read documents from paths
    const docs: Array<{ doc: Document; path: string }> = []
    for (const path of paths) {
      try {
        const content = await readTextFile(path)
        const doc = Document.fromMarkdown(content)
        docs.push({ doc, path })
      } catch {
        // Skip unreadable files
      }
    }

    // Build DomainCollection with entity resolution
    const collection = DomainCollection.fromDocuments(docs, store, { depth })

    // Step 4: Format output
    const baseDir = config.DIR_BASE as string
    const markdown = collection.toMarkdown({ relativeTo: baseDir, delimited: true })

    if (json) {
      output.log(
        JSON.stringify(
          {
            question,
            query,
            count,
            paths,
            data,
          },
          null,
          2,
        ),
      )
    } else if (raw) {
      output.log(markdown)
    } else {
      output.log('')
      output.log(colors.green(`✓ Gathered context for: "${question}"`))
      output.log(colors.dim(`  Query: ${query.slice(0, 60)}${query.length > 60 ? '...' : ''}`))
      output.log(colors.dim(`  Documents: ${count}`))
      output.log('')
      output.log(markdown)
    }

    return CommandResult.success({
      question,
      query,
      paths,
      count,
      markdown,
      data,
    })
  }
}
