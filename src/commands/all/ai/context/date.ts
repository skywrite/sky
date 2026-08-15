/**
 * AI Context Date - Extracts temporal information from a natural language prompt.
 *
 * Returns a lookback duration and any specific dates mentioned.
 *
 * Usage: sky ai:context:date "Look at my conversations with James from Feb 18 and Feb 24"
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveWindow } from './lib/widenSince.ts'

const PROMPT_FILE = new URL('./prompts/context-date.prompt.md', import.meta.url).pathname

interface DateResult {
  since: string
  until: string
  dates: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:context:date': { params: InferParams<typeof params>; result: DateResult }
  }
}

const params = {
  message: Arg.string('Natural language message to extract temporal info from'),
  json: Flag.bool('Output as JSON', { default: false }),
}

const schema = z.object({
  since: z
    .string()
    .describe(
      'Lookback duration for context search. Use shorthand: "7d", "30d", "6mo", "1y", "5y", etc. ' +
        'Only past-referring ranges count — future horizons ("next 3 months", "by year-end") are not lookbacks. ' +
        'Empty string "" if no past time range is mentioned or implied.',
    ),
  until: z
    .string()
    .describe(
      'End of the stated range in YYYY-MM-DD, when the message closes the window at a past date ' +
        '("through May 1", "between Feb and April", "in March 2026"). ' +
        'Empty string "" when the range runs to now ("since March", "last 6 months") or no range is stated.',
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
      'when no past time range is present — future horizons ("next 3 months")',
      'are planning targets, not lookbacks. The caller decides the default.',
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
      ...aiModel('fast'),
      schema,
      instructions: systemPrompt,
      prompt: message,
    })

    // Enforce window ⊇ stated dates — the model's calendar arithmetic is
    // untrusted (see lib/widenSince.ts). Dates are a floor, never a ceiling.
    const resolution = resolveWindow(object.since, object.until, object.dates, PlainDate.from(context.notebookNow.date))
    const { since, until } = resolution

    if (json) {
      output.log(JSON.stringify({ since, until, dates: object.dates }))
    } else {
      output.log(`since: ${since || '(none)'}`)
      if (until) {
        output.log(`until: ${until}`)
      }
      if (object.dates.length > 0) {
        output.log(`dates: ${object.dates.join(', ')}`)
      }
      if (resolution.widenedToCover) {
        output.log(`widened: ${object.since} → ${since} (covers stated ${resolution.widenedToCover})`)
      }
      if (resolution.extendedToCover) {
        output.log(`extended: until ${object.until} → ${until} (covers stated ${resolution.extendedToCover})`)
      }
      if (resolution.droppedInvalid) {
        output.log(`dropped unparseable duration "${resolution.droppedInvalid}" — searching all history`)
      }
    }

    return CommandResult.success({ since, until, dates: object.dates })
  }
}
