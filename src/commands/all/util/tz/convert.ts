import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import PlainDateTime from '#universal/dates/nbdt/PlainDateTime/mod.ts'
import { currentTimezoneIANA, timezoneToOffsetString } from '#universal/dates/timezones/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

const SYSTEM_PROMPT_FILE = new URL('./prompts/tz-convert-system.prompt.md', import.meta.url).pathname

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  query: Arg.string('Natural language timezone query'),
  json: Flag.boolean('Output as JSON', { default: false }),
}

type Params = InferParams<typeof params>

type Result = {
  local: ZonedDateTime
  utc: ZonedDateTime
  target: ZonedDateTime
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'util:tz:convert': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// AI Schema
// -----------------------------------------------------------------------------

const TimezoneParseSchema = z.object({
  hours: z.number().describe('Hour in 24-hour format (0-23)'),
  minutes: z.number().describe('Minutes (0-59)'),
  sourceTimezone: z.string().describe('IANA timezone of the input time (e.g., America/Chicago for "central")'),
  targetTimezone: z.string().describe('IANA timezone to convert to (e.g., Europe/Paris for "France")'),
  targetName: z.string().describe('Friendly name for the target location (e.g., "France", "Tokyo", "London")'),
  targetUses24Hour: z.boolean().describe('Whether the target location typically uses 24-hour time format'),
  dateOffset: z.number().default(0).describe('Days offset from today (-1 for yesterday, 1 for tomorrow, etc.)'),
})

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Countries/regions that typically use 24-hour format
const USES_24_HOUR_LOCAL = false // US uses 12-hour

function formatTime(zdt: ZonedDateTime, use24Hour: boolean): string {
  const jsDate = zdt.toTimeDateValue()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zdt.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  })
  return formatter.format(jsDate)
}

function formatDate(zdt: ZonedDateTime): string {
  const jsDate = zdt.toTimeDateValue()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zdt.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return formatter.format(jsDate)
}

interface TableRow {
  location: string
  time: string
  date: string
  offset: string
  iana: string
}

function buildRow(location: string, zdt: ZonedDateTime, use24Hour: boolean): TableRow {
  const jsDate = zdt.toTimeDateValue()
  return {
    location,
    time: formatTime(zdt, use24Hour),
    date: formatDate(zdt),
    offset: timezoneToOffsetString(zdt.timezone, jsDate),
    iana: zdt.timezone,
  }
}

function printTable(output: { log: (msg: string) => void }, rows: TableRow[]): void {
  // Calculate column widths
  const headers = ['Location', 'Time', 'Date', 'Offset', 'Timezone']
  const widths = headers.map((h, i) => {
    const colValues = rows.map((r) => Object.values(r)[i])
    return Math.max(h.length, ...colValues.map((v) => v.length))
  })

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ')
  const separator = widths.map((w) => '─'.repeat(w)).join('──')

  output.log(colors.dim(headerLine))
  output.log(colors.dim(separator))

  // Rows
  for (const row of rows) {
    const values = Object.values(row)
    const line = values
      .map((v, i) => {
        const padded = v.padEnd(widths[i])
        return i === 0 ? colors.bold(padded) : padded
      })
      .join('  ')
    output.log(line)
  }

  output.log('')
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class UtilTzConvertTask extends Command {
  static override description: CommandDescription = {
    name: 'util:tz:convert',
    description: 'Convert time between timezones using natural language.',
    descriptionLong: [
      'Takes a natural language query like "9:30 AM central today in france"',
      'and outputs the equivalent time in your local timezone, UTC, and the target timezone.',
    ],
    usage: [
      'sky util:tz:convert "9:30 AM central today in france"',
      'sky util:tz:convert "5 PM today in France"',
      'sky util:tz:convert "2:00 PM EST tomorrow in Tokyo"',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { query, json } = args

    // Get current system timezone
    const systemTimezone = currentTimezoneIANA()

    if (!json) {
      output.log(colors.dim(`Parsing: "${query}"`))
      output.log('')
    }

    // Load and render system prompt
    const promptContent = await readTextFile(SYSTEM_PROMPT_FILE)
    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        systemDate: context.systemNow.date,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone,
      },
    }
    const { output: systemPrompt } = renderPromptFile(promptContent, 'tz-convert-system.prompt.md', renderInput)

    // Use AI to parse the natural language query
    let parsed: z.infer<typeof TimezoneParseSchema>
    try {
      const result = await generateObject({
        model: anthropic('claude-sonnet-5'),
        schema: TimezoneParseSchema,
        system: systemPrompt,
        prompt: query,
      })
      parsed = result.object
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to parse timezone query')
    }

    // Calculate the date with offset
    const baseDate = context.systemNow.plainDateTime
    let targetDate = baseDate
    if (parsed.dateOffset !== 0) {
      // Add days by manipulating the date
      const parts = baseDate.date.split('-').map(Number)
      const jsDate = new Date(parts[0], parts[1] - 1, parts[2])
      jsDate.setDate(jsDate.getDate() + parsed.dateOffset)
      const newDateStr = jsDate.toISOString().slice(0, 10)
      targetDate = new PlainDateTime({ date: newDateStr, time: baseDate.time })
    }

    // Create the time string
    const timeStr = `${parsed.hours.toString().padStart(2, '0')}:${parsed.minutes.toString().padStart(2, '0')}`

    // Create ZonedDateTime in the source timezone
    const sourcePlainDateTime = new PlainDateTime({
      date: targetDate.date,
      time: timeStr,
    })
    const sourceZdt = new ZonedDateTime(sourcePlainDateTime, parsed.sourceTimezone)

    // Convert to other timezones
    const local = sourceZdt.inTimeZone(systemTimezone)
    const utc = sourceZdt.toUTC()
    const target = sourceZdt.inTimeZone(parsed.targetTimezone)

    // Output results
    if (json) {
      const toTemporal = (zdt: ZonedDateTime): string => {
        const jsDate = zdt.toTimeDateValue()
        const offset = timezoneToOffsetString(zdt.timezone, jsDate)
        return `${zdt.date}T${zdt.time}:00${offset}[${zdt.timezone}]`
      }
      output.log(
        JSON.stringify({
          local: toTemporal(local),
          utc: toTemporal(utc),
          target: toTemporal(target),
        }),
      )
    } else {
      const rows: TableRow[] = [
        buildRow('Local', local, USES_24_HOUR_LOCAL),
        buildRow(parsed.targetName, target, parsed.targetUses24Hour),
        buildRow('UTC', utc, true), // UTC always 24-hour
      ]
      printTable(output, rows)
    }

    return CommandResult.success({ local, utc, target })
  }
}
