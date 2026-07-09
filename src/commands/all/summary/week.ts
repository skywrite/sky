import * as path from 'node:path'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import openEditor from '#lib/shell/openEditor.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { gatherWeekHealthData, type WeekHealthData } from './_health.ts'
import { gatherWeekPriceData, type WeekPriceData } from './_prices.ts'

import { env } from '#shared/sys/mod.ts'

// Path to prompt template (relative to this file)
const PROMPT_FILE = new URL('./prompts/week.prompt.md', import.meta.url).pathname

const params = {
  start: Flag.plainDate('Start day (e.g., 19, 1-19, 2026-01-19)', {
    short: 's',
    required: true,
    parse: (input) => parsePartialDate(input, { rejectFuture: true }),
  }),
  end: Flag.plainDate('End day (e.g., 25, 1-25, 2026-01-25)', {
    short: 'e',
    required: true,
    parse: (input) => parsePartialDate(input, { rejectFuture: true }),
  }),
  model: Flag.string('Claude model to use', {
    short: 'm',
    default: () => 'claude-opus-4-6',
  }),
  force: Flag.boolean('Overwrite existing summary file', {
    short: 'f',
    default: false,
  }),
  allowMissing: Flag.boolean('Continue even if some days are missing summaries', {
    default: false,
  }),
  dryRun: Flag.boolean('Show prompt without calling AI', {
    default: false,
  }),
  stdout: Flag.boolean('Output summary to stdout instead of file', {
    default: false,
  }),
  open: Flag.boolean('Open summary in editor after creation', {
    short: 'o',
    default: false,
  }),
  export: Flag.boolean('Export summary as PDF to ~/Desktop', {
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { path?: string; pdfPath?: string; dryRun?: boolean; stdout?: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'summary:week': { params: Params; result: Result }
  }
}

export default class SummaryWeekTask extends Command {
  static override description: CommandDescription = {
    name: 'summary:week',
    description: 'Generate AI-powered weekly summary - momentum and opportunities',
    descriptionLong: [
      'Creates a summary.md file in the week directory by synthesizing daily summaries.',
      'Strategic view: What moved forward, big opportunities, action taken, health trends.',
      'Feeds into weekly planning.',
      '',
      'By default, errors if any day in the range is missing a summary.md.',
      'Use --allow-missing to continue with partial data.',
    ],
    usage: [
      'sky summary:week -s 19 -e 25              # Summarize Jan 19-25 (current month)',
      'sky summary:week --start 1-19 --end 1-25  # Summarize Jan 19-25',
      'sky summary:week -s 2026-01-19 -e 2026-01-25  # Summarize specific date range',
      'sky summary:week -s 19 -e 25 --dry-run    # Preview prompt without calling AI',
      'sky summary:week -s 19 -e 25 --allow-missing  # Continue even if some days missing',
      'sky summary:week -s 19 -e 25 --force      # Overwrite existing summary',
      'sky summary:week -s 19 -e 25 --export     # Export existing summary as PDF',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { start, end, model, force, allowMissing, dryRun, stdout, open } = args
    const exportPdf = args.export

    // Validate date range
    if (end.toString() < start.toString()) {
      return CommandResult.fail(`End date (${end.ymd}) must be after start date (${start.ymd})`)
    }

    const timeDir = <string>config.DIR_TIME

    // Output goes to the start day's week directory
    const weekDirPath = path
      .join(timeDir, dayDir(start))
      .replace(/\/\d+$/, '')
      .replace(/\/x\d+$/, '')
    const summaryPath = path.join(weekDirPath, 'summary.md')

    // --export: export existing summary as PDF (no AI generation)
    if (exportPdf) {
      if (!(await exists(summaryPath))) {
        return CommandResult.fail('No summary.md found. Run summary:week first to generate one.')
      }
      const pdfPath = this.pdfPath(start, end)
      output.log(`Exporting existing summary to PDF...`)
      const result = await tasks.run<{ pdfPath: string }>('markdown:pdf', {
        file: summaryPath,
        output: pdfPath,
        title: `Weekly Summary – ${start.ymd} to ${end.ymd}`,
      })
      if (result.status !== 'success') {
        return CommandResult.fail(result.message || 'PDF export failed')
      }
      return CommandResult.success({ path: summaryPath, pdfPath })
    }

    // Check if summary already exists (skip if outputting to stdout)
    if (!stdout && !force && (await exists(summaryPath))) {
      return CommandResult.fail('Week summary already exists. Use --force to overwrite.')
    }

    output.log(`Generating Weekly Summary for ${start.ymd} - ${end.ymd}...`)

    // 1. Generate all dates in range
    const dates = this.getDatesInRange(start, end)
    output.log(`Date range: ${dates.length} days`)

    // 2. Read summary.md from each day
    const dailyBriefs: Array<{ date: PlainDate; content: string }> = []
    const missingDays: PlainDate[] = []

    for (const date of dates) {
      const dayDirPath = path.join(timeDir, dayDir(date))
      const summaryFile = path.join(dayDirPath, 'summary.md')

      if (await exists(summaryFile)) {
        try {
          const content = await readTextFile(summaryFile)
          if (content.length > 100) {
            dailyBriefs.push({ date, content })
            output.log(`  - ${date.ymd}: summary.md found`)
          } else {
            missingDays.push(date)
            output.log(`  - ${date.ymd}: summary.md empty or too short`)
          }
        } catch {
          missingDays.push(date)
          output.log(`  - ${date.ymd}: summary.md unreadable`)
        }
      } else {
        missingDays.push(date)
        output.log(`  - ${date.ymd}: no summary.md`)
      }
    }

    // 3. Check for missing days
    if (missingDays.length > 0 && !allowMissing) {
      const missingList = missingDays.map((d) => d.ymd).join(', ')
      return CommandResult.fail(
        `Missing daily summaries for: ${missingList}\n` +
          'Run summary:day for each day first, or use --allow-missing to continue with partial data.',
      )
    }

    if (dailyBriefs.length === 0) {
      return CommandResult.fail('No daily summaries found. Run summary:day for each day first.')
    }

    output.log(`Loaded ${dailyBriefs.length} of ${dates.length} daily briefs`)

    // 4. Load health data for the week
    const healthData = await gatherWeekHealthData(start, timeDir)
    const healthFiles = Object.keys(healthData).length
    if (healthFiles > 0) {
      output.log(`Loaded ${healthFiles} health CSV files`)
    }

    // 5. Load price data for the week
    const priceData = await gatherWeekPriceData(start, end, <string>config.DIR_TRACKING)
    const priceFiles = Object.keys(priceData).length
    if (priceFiles > 0) {
      output.log(`Loaded ${priceFiles} price CSV files`)
    }

    // 6. Load prompt template
    const promptTemplate = await this.loadPromptTemplate()

    // 7. Build user prompt (prices + health data + week context + collated daily briefs)
    const userPrompt = this.buildUserPrompt(start, end, dailyBriefs, healthData, priceData)

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    // 7. Call Claude
    output.log('Calling Claude...')
    let response: string
    try {
      const result = await generateText({
        model: anthropic(model),
        instructions: promptTemplate,
        prompt: userPrompt,
      })
      response = result.text
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // 8. Build output file
    const yamlHeader: Record<string, unknown> = {
      title: 'Weekly Summary',
      week: `${start.ymd} - ${end.ymd}`,
      days: dailyBriefs.length,
      generated: new Date().toISOString(),
      model,
      tags: 'Summary/Weekly',
    }

    const outputContent = ['---', stringify(yamlHeader).trim(), '---', '', response].join('\n')

    // 9. Output
    if (stdout) {
      output.log(outputContent)
      return CommandResult.success({ stdout: true })
    }

    // Write file
    await writeTextFile(summaryPath, outputContent)
    output.log(`Weekly Summary written to ${summaryPath}`)

    // 10. Open in editor if requested
    if (open) {
      await openEditor([{ file: summaryPath }])
    }

    return CommandResult.success({ path: summaryPath })
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'week.prompt.md')
    return output
  }

  private getDatesInRange(start: PlainDate, end: PlainDate): PlainDate[] {
    const dates: PlainDate[] = []
    let current = start

    while (current.toString() <= end.toString()) {
      dates.push(current)
      current = current.addDays(1)
    }

    return dates
  }

  private buildUserPrompt(
    start: PlainDate,
    end: PlainDate,
    dailyBriefs: Array<{ date: PlainDate; content: string }>,
    healthData: WeekHealthData,
    priceData: WeekPriceData,
  ): string {
    const parts: string[] = []

    // Price data at the top (raw CSV content)
    const hasPriceData = priceData.btc || priceData.spy || priceData.exod
    if (hasPriceData) {
      parts.push('# Price Data (Raw CSV)')
      parts.push('')

      if (priceData.btc) {
        parts.push('## BTC_USD.csv')
        parts.push('```csv')
        parts.push(priceData.btc)
        parts.push('```')
        parts.push('')
      }

      if (priceData.spy) {
        parts.push('## SPY_USD.csv')
        parts.push('```csv')
        parts.push(priceData.spy)
        parts.push('```')
        parts.push('')
      }

      if (priceData.exod) {
        parts.push('## EXOD_USD.csv')
        parts.push('```csv')
        parts.push(priceData.exod)
        parts.push('```')
        parts.push('')
      }

      parts.push('---')
      parts.push('')
    }

    // Health data (raw CSV content)
    const hasHealthData =
      healthData.strength || healthData.distance || healthData.sleep || healthData.weight || healthData.work
    if (hasHealthData) {
      parts.push('# Health Data (Raw CSV)')
      parts.push('')

      if (healthData.strength) {
        parts.push('## strength.csv')
        parts.push('```csv')
        parts.push(healthData.strength)
        parts.push('```')
        parts.push('')
      }

      if (healthData.distance) {
        parts.push('## distance.csv')
        parts.push('```csv')
        parts.push(healthData.distance)
        parts.push('```')
        parts.push('')
      }

      if (healthData.sleep) {
        parts.push('## sleep.csv')
        parts.push('```csv')
        parts.push(healthData.sleep)
        parts.push('```')
        parts.push('')
      }

      if (healthData.weight) {
        parts.push('## weight.csv')
        parts.push('```csv')
        parts.push(healthData.weight)
        parts.push('```')
        parts.push('')
      }

      if (healthData.work) {
        parts.push('## work.csv')
        parts.push('```csv')
        parts.push(healthData.work)
        parts.push('```')
        parts.push('')
      }

      parts.push('---')
      parts.push('')
    }

    // Header with week context
    parts.push(`# Weekly Input: ${start.ymd} - ${end.ymd}`)
    parts.push('')
    parts.push(`Period: ${dailyBriefs.length} days with daily briefs`)
    parts.push('')
    parts.push('Below are the Daily Summaries for this period. Generate the Weekly Summary.')
    parts.push('')
    parts.push('---')
    parts.push('')

    // Collate daily briefs with clear delimiters
    for (const brief of dailyBriefs) {
      parts.push(`<!-- START DAILY BRIEF: ${brief.date.ymd} (${brief.date.dayShort}) -->`)
      parts.push(brief.content)
      parts.push(`<!-- END DAILY BRIEF: ${brief.date.ymd} -->`)
      parts.push('')
    }

    return parts.join('\n')
  }

  private pdfPath(start: PlainDate, end: PlainDate): string {
    const home = env.get('HOME') ?? '/tmp'
    const endShort = `${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`
    return path.join(home, 'Desktop', `${start.ymd}_to_${endShort}_weekly_summary.pdf`)
  }
}
