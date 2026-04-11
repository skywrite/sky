/**
 * AI Context Selector - AI writes GraphQL to gather context for a question.
 *
 * Usage: sky ai:context:sel "What did I discuss with Alice last week?"
 */

import { generateText } from 'ai'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { formatEntityContext, gatherEntityContext } from './_entityContext.ts'
import { getLanguageModel, resolveModel, resolveProvider } from '../_lib/getLanguageModel.ts'

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
  provider: Flag.string('AI provider (claude, openai, ollama, lm-studio)', {
    short: 'p',
    default: () => 'claude',
  }),
  model: Flag.string('Model to use', {
    short: 'M',
    optional: true,
  }),
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
    const { question, provider, model: modelFlag, since } = args
    const resolvedProvider = resolveProvider(provider)
    const model = resolveModel(resolvedProvider, modelFlag)

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

    const result = await generateText({
      model: getLanguageModel(resolvedProvider, model),
      system: systemPrompt,
      prompt: userPrompt,
    })

    // Extract just the GraphQL query (remove any markdown code fences if present)
    let query = result.text.trim()
    if (query.startsWith('```graphql')) {
      query = query.slice(10)
    } else if (query.startsWith('```')) {
      query = query.slice(3)
    }
    if (query.endsWith('```')) {
      query = query.slice(0, -3)
    }
    query = query.trim()

    output.log(query)

    return CommandResult.success({ query })
  }
}
