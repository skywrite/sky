/**
 * AI Context Selector - AI writes GraphQL to gather context for a question.
 *
 * Usage: sky ai:context:sel "What did I discuss with Alice last week?"
 */

import { generateText } from 'ai'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel } from '#shared/ai/models.ts'
import { cachedInstructions } from '#shared/ai/promptCache.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { parseDuration } from '#shared/models/DomainCollection/query/filters/mod.ts'
import {
  dropInvalidSelections,
  expandMissingSubfields,
  graphQLValidationErrors,
  normalizeGraphQLQuery,
} from '#shared/models/DomainCollection/query/normalize.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { formatEntityContext, gatherEntityContext } from './_entityContext.ts'

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
  until: Flag.string('Close the window at this date (YYYY-MM-DD); with --since forms a closed range', {
    optional: true,
  }),
  from: Flag.string('Exact start of the closed range (YYYY-MM-DD); overrides the since-derived start', {
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
    const { question, since, until, from } = args

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

    // A stated end switches the hint from a trailing `recent:` window to an
    // absolute dateGte/dateLte pair — `recent:` always closes at now and
    // would silently re-include everything after the stated end.
    let sinceHint = ''
    if (since && until) {
      // The stated start is exact; deriving from the duration is the
      // fallback — an over-generous duration would bleed the range earlier
      // than the user said.
      const start = from ?? PlainDate.from(context.notebookNow.date).addDays(-parseDuration(since)).toString()
      sinceHint = `\n\nIMPORTANT: The user scoped this question to ${start} through ${until}. Put \`dateGte: "${start}"\` and \`dateLte: "${until}"\` in the \`where\` of every dated root (meetings, messages, journals, chats, videos, documents) and omit \`limit\` on those roots — the pair is the bound (date-bounded queries are uncapped) and downstream budgeting prunes any excess. A \`limit\` beside the bound would silently keep only the newest slice of the window. Never use \`recent\` here — it would re-open the window to now.`
    } else if (until) {
      sinceHint = `\n\nIMPORTANT: The user scoped this question to everything up to ${until}. Put \`dateLte: "${until}"\` in the \`where\` of every dated root (meetings, messages, journals, chats, videos, documents). Never use \`recent\` here — it would re-open the window to now.`
    } else if (since) {
      sinceHint = `\n\nIMPORTANT: The user scoped this question to the last ${since}. Put \`recent: "${since}"\` in the \`where\` of every dated root (meetings, messages, journals, chats, videos, documents) and omit \`limit\` on those roots — the period is the bound (date-bounded queries are uncapped) and downstream budgeting prunes any excess. A \`limit\` beside the bound would silently keep only the newest slice of the window.`
    }

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

    // Strip code fences and wrap bare selections so the query always parses,
    // then expand bare object-typed fields (`when` → `when { datetime }`)
    let query = await expandMissingSubfields(normalizeGraphQLQuery(result.text))

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

      query = await expandMissingSubfields(normalizeGraphQLQuery(repair.text))
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
