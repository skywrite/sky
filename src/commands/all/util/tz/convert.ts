import { generateObject } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import { currentTimezoneIANA, timezoneToOffsetString } from '#universal/dates/timezones/mod.ts'
import { nextClockChange } from './lib/nextClockChange.ts'
import { resolveAnchor } from './lib/resolveAnchor.ts'

const SYSTEM_PROMPT_FILE = new URL('./prompts/tz-convert-system.prompt.md', import.meta.url).pathname

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  query: Arg.string('Natural language timezone query'),
  json: Flag.bool('Output as JSON', { default: false }),
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

// The model only classifies the query — `kind` picks which of the other fields apply, and
// resolveAnchor() does the arithmetic. Kept flat rather than a discriminated union because
// nested unions round-trip less reliably through generateObject.
const TimezoneParseSchema = z.object({
  kind: z
    .enum(['now', 'relative', 'wallClock'])
    .describe(
      "Query shape: 'now' for the current instant, 'relative' for an offset from now, 'wallClock' for a time the user supplied",
    ),
  relativeMinutes: z.number().default(0).describe('kind=relative only: minutes from now, negative for the past'),
  hours: z.number().default(0).describe('kind=wallClock only: hour in 24-hour format (0-23)'),
  minutes: z.number().default(0).describe('kind=wallClock only: minutes (0-59)'),
  dateOffset: z
    .number()
    .default(0)
    .describe('kind=wallClock only: days offset from today (-1 for yesterday, 1 for tomorrow)'),
  sourceTimezone: z
    .string()
    .default('')
    .describe("kind=wallClock only: IANA timezone the supplied time is in; empty for the user's own timezone"),
  targetTimezone: z.string().describe('IANA timezone to display the result in (e.g., Asia/Bangkok)'),
  targetName: z.string().describe('Friendly name for the target location (e.g., "Bangkok", "France", "Tokyo")'),
  targetUses24Hour: z.boolean().describe('Whether the target location typically uses 24-hour time format'),
})

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Whether the user's own locale renders 24-hour time.
function localUses24Hour(): boolean {
  const { hourCycle, hour12 } = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
  if (typeof hour12 === 'boolean') return !hour12
  return hourCycle === 'h23' || hourCycle === 'h24'
}

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

// Row emphasis: the target is what was asked for, UTC is the machine reference, and the
// local row sits between them uncolored.
type RowTone = 'answer' | 'plain' | 'muted'

const TONES: Record<RowTone, (line: string) => string> = {
  answer: colors.cyan,
  plain: (line) => line,
  muted: colors.dim,
}

interface TableRow {
  cells: string[]
  tone: RowTone
}

// Date of the zone's next clock change, in that zone's own local terms. "N/A" reads better
// than a blank for zones that never shift.
function formatNextClockChange(timezone: string, from: Date): string {
  const change = nextClockChange(timezone, from)
  if (!change) return 'N/A'
  const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric' }).format(
    change.at,
  )
  // Always signed — the direction is the point, so "+1h" is worth the character over "1h".
  const sign = change.deltaHours < 0 ? '-' : '+'
  return `${date} (${sign}${Math.abs(change.deltaHours)}h)`
}

function buildRow(location: string, zdt: ZonedDateTime, use24Hour: boolean, tone: RowTone): TableRow {
  // Both the offset and the clock change are read at the instant being converted, so a query
  // about a future date reports the shift that follows *it*, not the one following today.
  const jsDate = zdt.toTimeDateValue()
  return {
    cells: [
      location,
      formatTime(zdt, use24Hour),
      formatDate(zdt),
      timezoneToOffsetString(zdt.timezone, jsDate),
      zdt.timezone,
      formatNextClockChange(zdt.timezone, jsDate),
    ],
    tone,
  }
}

function printTable(output: { log: (msg: string) => void }, rows: TableRow[]): void {
  // Calculate column widths
  const headers = ['Location', 'Time', 'Date', 'Offset', 'Timezone', 'Next DST']
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r.cells[i].length)))

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ')
  const separator = widths.map((w) => '─'.repeat(w)).join('──')

  output.log(colors.dim(headerLine))
  output.log(colors.dim(separator))

  // Rows. Pad before coloring — ANSI escapes would otherwise count toward the column width.
  for (const row of rows) {
    const line = row.cells
      .map((v, i) => {
        const padded = v.padEnd(widths[i])
        // Bold and dim share one intensity reset, so the muted row leaves its label unbolded
        // rather than have the label's reset cancel the row's dim.
        return i === 0 && row.tone !== 'muted' ? colors.bold(padded) : padded
      })
      .join('  ')
    output.log(TONES[row.tone](line))
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
      'Queries can supply a time to convert, ask for the current time somewhere,',
      'or offset from now.',
    ],
    usage: [
      'sky util:tz:convert "now in Bangkok"',
      'sky util:tz:convert "what time is it in Tokyo"',
      'sky util:tz:convert "in 3 hours in Tokyo"',
      'sky util:tz:convert "9:30 AM central today in france"',
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
        systemTime: context.systemNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone,
      },
    }
    const { output: systemPrompt } = renderPromptFile(promptContent, 'tz-convert-system.prompt.md', renderInput)

    // Use AI to parse the natural language query
    let parsed: z.infer<typeof TimezoneParseSchema>
    try {
      const result = await generateObject({
        ...aiModel('balanced'),
        schema: TimezoneParseSchema,
        instructions: systemPrompt,
        prompt: query,
      })
      parsed = result.object
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to parse timezone query')
    }

    // Resolve the instant to convert from — the current clock for "now"/relative queries,
    // the supplied wall clock otherwise
    const sourceZdt = resolveAnchor(parsed, context.systemNow, systemTimezone)

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
        buildRow('Local', local, localUses24Hour(), 'plain'),
        buildRow(parsed.targetName, target, parsed.targetUses24Hour, 'answer'),
        buildRow('UTC', utc, true, 'muted'), // UTC always 24-hour
      ]
      printTable(output, rows)
    }

    return CommandResult.success({ local, utc, target })
  }
}
