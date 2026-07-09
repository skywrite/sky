/**
 * AI Context Date - Extracts temporal information from a natural language prompt.
 *
 * Returns a lookback duration and any specific dates mentioned.
 *
 * Usage: sky ai:context:date "Look at my conversations with James from Feb 18 and Feb 24"
 */

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const PROMPT_FILE = new URL('./prompts/context-date.prompt.md', import.meta.url).pathname

interface DateResult {
  since: string
  dates: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:date': { params: InferParams<typeof params>; result: DateResult }
  }
}

const params = {
  message: Arg.string('Natural language message to extract temporal info from'),
  json: Flag.boolean('Output as JSON', { default: false }),
}

const schema = z.object({
  since: z
    .string()
    .describe(
      'Lookback duration for context search. Use shorthand: "7d", "30d", "6mo", "1y", "5y", etc. ' +
        'Empty string "" if no time range is mentioned or implied.',
    ),
  dates: z
    .array(z.string())
    .describe('Specific dates mentioned in the message, in YYYY-MM-DD format. Empty array if none.'),
})

export default class AIContextDateTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:context:date',
    description: 'Extract temporal information from a natural language message',
    descriptionLong: [
      'Extracts two things from a message:',
      '1. A lookback duration (e.g., "6mo", "5y") for how far back to search',
      '2. Any specific dates mentioned (e.g., "2026-02-18")',
      '',
      'Uses Haiku for fast, cheap extraction. Returns empty string for since',
      'when no temporal signal is present — the caller decides the default.',
    ],
    usage: [
      'sky ai:context:date "What did I discuss with Alice last week?"',
      'sky ai:context:date "Look back 5 years at my relationship with James"',
      'sky ai:context:date "Check the Feb 18 and Feb 24 threads"',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<InferParams<typeof params>>): Promise<CommandResult<DateResult>> {
    const { output } = context
    const { message, json } = args

    const promptContent = await readTextFile(PROMPT_FILE)
    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
    }
    const { output: systemPrompt } = renderPromptFile(promptContent, 'context-date.prompt.md', renderInput)

    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema,
      instructions: systemPrompt,
      prompt: message,
    })

    if (json) {
      output.log(JSON.stringify({ since: object.since, dates: object.dates }))
    } else {
      output.log(`since: ${object.since || '(none)'}`)
      if (object.dates.length > 0) {
        output.log(`dates: ${object.dates.join(', ')}`)
      }
    }

    return CommandResult.success({ since: object.since, dates: object.dates })
  }
}
