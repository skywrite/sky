/**
 * AI Context Selector - AI writes GraphQL to gather context for a question.
 *
 * Usage: sky ai:context:sel "What did I discuss with Alice last week?"
 */

import { generateText } from 'ai'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { normalizeGraphQLQuery } from '#shared/models/DomainCollection/query/normalize.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { formatEntityContext, gatherEntityContext } from './_entityContext.ts'
import { aiModel } from '#shared/ai/models.ts'

// -----------------------------------------------------------------------------
// File Paths
// -----------------------------------------------------------------------------

const PROMPT_FILE = new URL('./prompts/context-sel.prompt.md', import.meta.url).pathname
const SCHEMA_FILE = new URL('../../../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url)
  .pathname

// -----------------------------------------------------------------------------
// Params
// -----------------------------------------------------------------------------

const params = {
  question: Arg.string('Question to gather context for'),
  since: Flag.string('Limit time-based queries to this period (e.g., 1y, 6mo)', {
    short: 's',
    optional: true,
  }),
}

type Params = InferParams<typeof params>
type Result = { query: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:sel': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AIContextSelectorTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:context:sel',
    description: 'AI generates GraphQL to gather context for a question',
    descriptionLong: [
      'Given a question, uses AI to determine what GraphQL query would gather',
      'the necessary context to answer it. Returns the GraphQL query string.',
      '',
      'The AI receives the full GraphQL schema and writes a query to fetch',
      'relevant meetings, messages, people, projects, decisions, etc.',
    ],
    usage: [
      'sky ai:context:sel "What did I discuss with Alice last week?"',
      'sky ai:context:sel "What are my pending decisions?"',
      'sky ai:context:sel "Show me everything related to the Acme project"',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { question, since } = args

    // Load prompt, schema, and entity context in parallel
    const [promptContent, schema, entityCtx] = await Promise.all([
      readTextFile(PROMPT_FILE),
      readTextFile(SCHEMA_FILE),
      gatherEntityContext(config as Record<string, unknown>, tasks),
    ])

    const entityBlock = formatEntityContext(entityCtx)

    // Render prompt with variables
    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      user: { schema },
      entities: { block: entityBlock },
    }

    const { output: systemPrompt } = renderPromptFile(promptContent, 'context-sel.prompt.md', renderInput)

    const sinceHint = since
      ? `\n\nIMPORTANT: For time-based queries (meetings, messages, journals), include \`recent: "${since}"\` to limit results to the last ${since}.`
      : ''

    const userPrompt = `Question: ${question}${sinceHint}

Write the GraphQL query to gather context for answering this question.`

    // Query generation runs on the balanced role (Sonnet-tier): it matches Opus
    // on query quality at lower cost/latency for this task (eval 2026-06-13 on
    // Sonnet 4.6; role now points at Sonnet 5).
    const result = await generateText({
      ...aiModel('balanced'),
      instructions: systemPrompt,
      prompt: userPrompt,
    })

    // Strip code fences and wrap bare selections so the query always parses
    const query = normalizeGraphQLQuery(result.text)

    output.log(query)

    return CommandResult.success({ query })
  }
}
