/**
 * AI Context Evolve - Evolves GraphQL queries based on conversation direction.
 *
 * Given existing queries, a new user message, and recent conversation turns,
 * returns the same queries (no change), modified queries, or entirely new ones.
 * Uses Sonnet for fast, cheap query evolution.
 *
 * Usage: sky ai:context:evolve "What are the financial implications?" --queries '["{ meetings... }"]'
 */

import { generateObject } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { cachedInstructions } from '#shared/ai/promptCache.ts'
import { z } from 'zod'
import colors from 'picocolors'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import {
  dropInvalidSelections,
  graphQLValidationErrors,
  normalizeGraphQLQuery,
} from '#shared/models/DomainCollection/query/normalize.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { formatEntityContext, gatherEntityContext } from './_entityContext.ts'

const PROMPT_FILE = new URL('./prompts/context-evolve.prompt.md', import.meta.url).pathname
const SCHEMA_FILE = new URL('../../../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url)
  .pathname

interface EvolveResult {
  queries: string[]
  changed: boolean
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:evolve': { params: InferParams<typeof params>; result: EvolveResult }
  }
}

const params = {
  message: Arg.string('New user message'),
  queries: Flag.string('Current queries as JSON array', {
    short: 'q',
    default: () => '[]',
  }),
  conversation: Flag.string('Recent conversation turns as JSON array', {
    short: 'c',
    default: () => '[]',
  }),
  since: Flag.string('Limit time-based queries to this period', {
    short: 's',
    optional: true,
  }),
  json: Flag.boolean('Output as JSON', { default: false }),
}

const schema = z.object({
  queries: z
    .array(z.string())
    .describe(
      'The GraphQL queries to use for context gathering. Return the same queries if no change is needed, ' +
        'modified queries if the topic shifted, or entirely new queries if the conversation changed direction. ' +
        'Each query is a standalone GraphQL query string.',
    ),
  changed: z.boolean().describe('True if the queries differ from the input queries, false if they are unchanged.'),
})

export default class AIContextEvolveTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:context:evolve',
    description: 'Evolve GraphQL queries based on conversation direction',
    descriptionLong: [
      'Given existing queries and a new user message, determines whether',
      'the context queries need to change. Returns same, modified, or new queries.',
      '',
      'Uses Sonnet for fast, cheap evolution. Receives the same GraphQL schema',
      'and entity context as ai:context:sel.',
    ],
    usage: ['sky ai:context:evolve "What are the financial implications?" --queries \'["{ meetings... }"]\''],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<InferParams<typeof params>>): Promise<CommandResult<EvolveResult>> {
    const { config, output } = context
    const { message, queries: queriesJson, conversation: conversationJson, since, json } = args

    const currentQueries: string[] = JSON.parse(queriesJson)
    const recentTurns: Array<{ role: string; content: string }> = JSON.parse(conversationJson)

    // Load prompt, schema, and entity context in parallel
    const [promptContent, graphqlSchema, entityCtx] = await Promise.all([
      readTextFile(PROMPT_FILE),
      readTextFile(SCHEMA_FILE),
      gatherEntityContext(config as Record<string, unknown>, tasks),
    ])

    const entityBlock = formatEntityContext(entityCtx)

    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      user: { schema: graphqlSchema },
      entities: { block: entityBlock },
    }

    const { output: systemPrompt } = renderPromptFile(promptContent, 'context-evolve.prompt.md', renderInput)

    // Build user prompt with current state
    const parts: string[] = []

    if (currentQueries.length > 0) {
      parts.push('## Current Queries\n')
      for (const q of currentQueries) {
        parts.push('```graphql\n' + q + '\n```\n')
      }
    } else {
      parts.push('## Current Queries\n\n(none — this is the first query generation)\n')
    }

    if (recentTurns.length > 0) {
      parts.push('## Recent Conversation\n')
      for (const turn of recentTurns.slice(-6)) {
        const role = turn.role === 'user' ? 'User' : 'Assistant'
        const content = turn.content.length > 300 ? turn.content.slice(0, 300) + '...' : turn.content
        parts.push(`**${role}:** ${content}\n`)
      }
    }

    parts.push(`## New Message\n\n${message}`)

    if (since) {
      parts.push(
        `\nIMPORTANT: For time-based queries (meetings, messages, journals), include \`recent: "${since}"\` to limit results to the last ${since}.`,
      )
    }

    const { object } = await generateObject({
      ...aiModel('balanced'),
      schema,
      instructions: cachedInstructions(systemPrompt),
      prompt: parts.join('\n'),
    })

    // The model sometimes returns bare selections (`meetings(...) { ... }`)
    // without the enclosing braces, which fail to parse downstream. Normalize
    // wraps those; empties are dropped rather than executed as parse errors.
    const normalized = object.queries.map(normalizeGraphQLQuery).filter((q) => q !== '')

    // Normalization only fixes shape and repairable defects — the model
    // occasionally leaks fragments of its own structured-output envelope
    // (e.g. "{changed:true}}") into the queries array, or hallucinates filter
    // fields the schema doesn't define. Salvage what the executor would
    // reject: keep a query's valid selections and drop only the invalid ones
    // (they'd fail every later evolve round too); a query with nothing
    // salvageable is dropped whole, as before.
    const queries: string[] = []
    for (const q of normalized) {
      const salvaged = await dropInvalidSelections(q)
      if (salvaged === null) {
        const validationErrors = (await graphQLValidationErrors(q)) ?? ['unsalvageable query']
        output.log(colors.yellow(`Dropped invalid query (${validationErrors.join('; ')})`))
        await logAIError({
          source: 'ai:context:evolve',
          stage: 'invalid-query',
          message: validationErrors.join('; '),
          query: q,
        })
        continue
      }

      if (salvaged.dropped.length > 0) {
        const keys = salvaged.dropped.map((d) => d.key).join(', ')
        output.log(colors.yellow(`Dropped invalid selection(s): ${keys}`))
        await logAIError({
          source: 'ai:context:evolve',
          stage: 'salvaged-query',
          message: `Dropped invalid selection(s): ${keys}`,
          query: q,
          errors: salvaged.dropped.flatMap((d) => d.errors),
        })
      }
      queries.push(salvaged.query)
    }

    if (json) {
      output.log(JSON.stringify({ queries, changed: object.changed }))
    } else {
      output.log(`changed: ${object.changed}`)
      if (queries.length > 0) {
        for (const q of queries) {
          output.log(q)
        }
      }
    }

    return CommandResult.success({ queries, changed: object.changed })
  }
}
