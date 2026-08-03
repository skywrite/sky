/**
 * AI Context Selector - AI writes GraphQL to gather context for a question.
 *
 * Usage: sky ai:context:sel "What did I discuss with Alice last week?"
 */

import { generateText } from 'ai'
import colors from 'picocolors'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import {
  dropInvalidSelections,
  graphQLValidationErrors,
  normalizeGraphQLQuery,
} from '#shared/models/DomainCollection/query/normalize.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { formatEntityContext, gatherEntityContext } from './_entityContext.ts'
import { aiModel } from '#shared/ai/models.ts'
import { cachedInstructions } from '#shared/ai/promptCache.ts'
import { logAIError } from '#shared/ai/errorLog.ts'

// -----------------------------------------------------------------------------
// File Paths
// -----------------------------------------------------------------------------

const PROMPT_FILE = new URL('./prompts/context-sel.prompt.md', import.meta.url).pathname
const SCHEMA_FILE = new URL('../../../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url)
  .pathname

/** Repair rounds for queries the schema validator rejects. */
const MAX_QUERY_REPAIRS = 2

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
      gatherEntityContext(config as Record<string, unknown>),
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
      instructions: cachedInstructions(systemPrompt),
      prompt: userPrompt,
    })

    // Strip code fences and wrap bare selections so the query always parses
    let query = normalizeGraphQLQuery(result.text)

    // Normalization repairs shape, not meaning — the model occasionally
    // hallucinates filter fields or argument placement the schema rejects,
    // and one invalid field drops the whole query document downstream. Hand
    // the validator's errors back for a repair round instead; each rejection
    // is logged so recurring hallucination shapes stay visible even when the
    // repair succeeds. The instructions prefix is byte-identical across
    // rounds, so repairs read the schema from the prompt cache.
    let validationErrors = await graphQLValidationErrors(query)
    for (let attempt = 1; validationErrors && attempt <= MAX_QUERY_REPAIRS; attempt++) {
      output.log(colors.yellow(`Query failed validation — repairing (${attempt}/${MAX_QUERY_REPAIRS})`))
      await logAIError({
        source: 'ai:context:sel',
        stage: 'invalid-query',
        message: validationErrors.join('; '),
        query,
        question,
      })

      const repair = await generateText({
        ...aiModel('balanced'),
        instructions: cachedInstructions(systemPrompt),
        prompt: `${userPrompt}

Your previous query was rejected by the GraphQL validator.

Previous query:
${query}

Validation errors:
${validationErrors.map((e) => `- ${e}`).join('\n')}

Fix the query so it validates against the schema. Return ONLY the corrected GraphQL query.`,
      })

      query = normalizeGraphQLQuery(repair.text)
      validationErrors = await graphQLValidationErrors(query)
    }

    // Repairs exhausted with errors left: salvage the valid selections so
    // one stubborn hallucination costs its selection, not the whole fetch.
    // When nothing is salvageable, return the query as-is — execution
    // reports and logs the failure exactly as before.
    if (validationErrors) {
      const salvaged = await dropInvalidSelections(query)
      if (salvaged && salvaged.dropped.length > 0) {
        const keys = salvaged.dropped.map((d) => d.key).join(', ')
        output.log(colors.yellow(`Repairs exhausted — dropped invalid selection(s): ${keys}`))
        await logAIError({
          source: 'ai:context:sel',
          stage: 'salvaged-query',
          message: `Dropped invalid selection(s) after repair rounds: ${keys}`,
          query,
          errors: salvaged.dropped.flatMap((d) => d.errors),
          question,
        })
        query = salvaged.query
      }
    }

    output.log(query)

    return CommandResult.success({ query })
  }
}
