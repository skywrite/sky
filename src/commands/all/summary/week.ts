import * as path from 'node:path'
import { generateText } from 'ai'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import openEditor from '#lib/shell/openEditor.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile, getProfile } from '#shared/ai/models.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { dayDir, fetchNow, weekDir } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { gatherWeekHealthData, type WeekHealthCsv } from './_health.ts'
import { gatherWeekPriceData, type WeekPriceCsv } from './_prices.ts'
import { parseSummaryContext, serializeSummaryContext } from './lib/contextRecord.ts'
import gatherWeekSummaries, { type WeekSummaryEntry } from './lib/gatherWeekSummaries.ts'

const PROMPT_FILE = new URL('./prompts/week.prompt.md', import.meta.url).pathname

// Hard ceiling matching summary:day. Seven dailies plus tracking CSVs land
// far below it in practice; the shared gate is uniformity, not an expected
// limit — and like the day, an over-budget week refuses instead of trimming.
const CONTEXT_BUDGET_TOKENS = 300_000

// The weekly is the week's canonical record and the primary input to weekly
// planning — same top-tier model as the dailies it is built from.
const DEFAULT_PROFILE = 'default-fable-5'

const params = {
  week: Arg.string('Week to summarize (e.g., 33, W33, 2026-W02) — defaults to the last completed week', {
    optional: true,
  }),
  model: Flag.string('Model profile to use', { short: 'm', default: () => DEFAULT_PROFILE }),
  force: Flag.bool('Overwrite existing summary file', { short: 'f', default: false }),
  allowMissing: Flag.bool('Continue even if some days are missing summaries', { default: false }),
  dryRun: Flag.bool('Show prompt without calling AI', { default: false }),
  stdout: Flag.bool('Output summary to stdout instead of file', { default: false }),
  open: Flag.bool('Open summary in editor after creation', { short: 'o', default: true }),
  export: Flag.bool('Export summary as PDF to ~/Desktop', { short: 'e', default: false }),
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
    description: 'Generate AI-powered weekly summary - the week at altitude, from its daily summaries',
    descriptionLong: [
      'Creates a summary.md in the week directory by synthesizing the Daily Summaries.',
      'The arc of the week: Against the Plan (when the week had a week.md), What Moved Forward,',
      'Decisions, Open Loops, Time, Health Trends, Signals, Learned.',
      "Reads as the week's canonical record and feeds weekly planning.",
      '',
      'By default, errors if any day of the week is missing its summary.md.',
      'Use --allow-missing to generate from partial coverage — gaps are named, never papered over.',
    ],
    usage: [
      'sky summary:week                # Summarize the last completed week',
      'sky summary:week 33             # Summarize W33 of the current year',
      'sky summary:week 2026-W02      # Summarize a specific week',
      'sky summary:week --dry-run      # Preview prompt without calling AI',
      'sky summary:week 33 --force     # Overwrite existing summary',
      'sky summary:week 33 --export    # Export existing summary as PDF',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { model, force, allowMissing, dryRun, stdout, open } = args
    const exportPdf = args.export

    const now = await fetchNow()
    const today = now.plainDateTime.plainDate

    let week: Week
    try {
      week = args.week ? Week.parse(args.week, Week.of(now).year) : Week.of(now).previous()
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    // A week is summarized whole — refuse until its Sunday has passed.
    if (PlainDate.compare(week.end, today) >= 0) {
      return CommandResult.fail(
        `${week.toString()} (${week.start.ymd} – ${week.end.ymd}) isn't complete yet. ` +
          'The weekly summary is generated after the week ends.',
      )
    }

    const timeDir = <string>config.DIR_TIME
    const weekDirPath = path.join(timeDir, weekDir(week.startInYear))
    const summaryPath = path.join(weekDirPath, 'summary.md')

    // --export: export existing summary as PDF (no AI generation)
    if (exportPdf) {
      if (!(await exists(summaryPath))) {
        return CommandResult.fail('No summary.md found. Run summary:week first to generate one.')
      }
      const pdfPath = this.pdfPath(week)
      output.log(`Exporting existing summary to PDF...`)
      const result = await tasks.run<{ pdfPath: string }>('markdown:pdf', {
        file: summaryPath,
        output: pdfPath,
        title: `Weekly Summary – ${week.toString()}`,
      })
      if (result.status !== 'success') {
        return CommandResult.fail(result.message || 'PDF export failed')
      }
      return CommandResult.success({ path: summaryPath, pdfPath })
    }

    // Check if summary already exists (skip if outputting to stdout or dry-run)
    if (!stdout && !dryRun && !force && (await exists(summaryPath))) {
      return CommandResult.fail('Week summary already exists. Use --force to overwrite.')
    }

    // Resolve the profile up front — a bad -m should fail before any work,
    // and the resolved model id gets stamped into the output frontmatter.
    let modelId: string
    try {
      modelId = getProfile(model).model
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    output.log(`Generating Weekly Summary for ${week.toString()} (${week.start.ymd} – ${week.end.ymd})...`)

    // 1. Gather the dailies — the weekly is a record built from records, so
    // only summary.md counts as a day's input, never day.md or raw files.
    const { days: dailies, skipped } = await gatherWeekSummaries(week.days, timeDir)
    for (const d of dailies) {
      output.log(`  - ${d.date.ymd} (${d.date.dayShort}): summary.md`)
    }
    const gapReasons: Array<[PlainDate[], string]> = [
      [skipped.missing, 'no summary.md'],
      [skipped.tiny, 'summary.md is a stub'],
      [skipped.yamlError, 'summary.md has bad YAML'],
      [skipped.unreadable, 'summary.md unreadable'],
    ]
    for (const [dates, reason] of gapReasons) {
      for (const d of dates) output.log(`  ! ${d.ymd} (${d.dayShort}): ${reason}`)
    }

    if (dailies.length === 0) {
      return CommandResult.fail('No daily summaries found for this week. Run summary:day for each day first.')
    }

    const gapCount = week.days.length - dailies.length
    if (gapCount > 0 && !allowMissing && !dryRun) {
      return CommandResult.fail(
        `Missing daily summaries for ${gapCount} day(s) — see the list above.\n` +
          'Run summary:day for each first, or use --allow-missing to continue with partial coverage.',
      )
    }

    // 2. Previous week's summary as background — arc continuity, so ongoing
    // threads read as deltas instead of being re-narrated from zero.
    const prevWeek = week.previous()
    const prevPath = path.join(timeDir, weekDir(prevWeek.startInYear), 'summary.md')
    let previous: { week: Week; path: string; body: string } | undefined
    if (await exists(prevPath)) {
      previous = { week: prevWeek, path: prevPath, body: parseSummaryContext(await readTextFile(prevPath)).body }
      output.log(`Previous week (${prevWeek.toString()}): summary.md included as background`)
    } else {
      output.log(`Previous week (${prevWeek.toString()}): no summary`)
    }

    // 2b. The week's plan and checkin trail — the Against the Plan inputs.
    // week.md rides in its final state (the plan morphs by hand all week);
    // checkins.md opens with the original-plan snapshot, so the model can
    // name the drift between the two. Both optional: an unplanned week just
    // omits the section.
    const planPath = path.join(weekDirPath, 'week.md')
    const plan = (await exists(planPath)) ? await readTextFile(planPath) : undefined
    const checkinsPath = path.join(weekDirPath, 'checkins.md')
    const checkins = (await exists(checkinsPath)) ? await readTextFile(checkinsPath) : undefined
    output.log(plan ? 'Week plan: week.md (final state)' : 'Week plan: none')
    output.log(checkins ? 'Checkins: checkins.md (incl. original-plan snapshot)' : 'Checkins: none')

    // 3. Week-native tracking data: day-keyed health CSVs from the week dir,
    // asset prices filtered to the week.
    const healthCsvs = await gatherWeekHealthData(week.start, timeDir)
    if (healthCsvs.length > 0) output.log(`Health CSVs: ${healthCsvs.length}`)
    const priceCsvs = await gatherWeekPriceData(week.start, week.end, <string>config.DIR_DATA)
    if (priceCsvs.length > 0) output.log(`Price CSVs: ${priceCsvs.length}`)

    // 4. rel: union of the dailies' rel lists. A daily's flat rel list can't
    // tell orgs from people, so bare names sort as one alphabetical run with
    // projects/ entries after — same discoverability, coarser grouping.
    const relSet = new Set(dailies.flatMap((d) => d.rel))
    const byName = (a: string, b: string) => a.localeCompare(b)
    const rel = [
      ...[...relSet].filter((r) => !r.startsWith('projects/')).sort(byName),
      ...[...relSet].filter((r) => r.startsWith('projects/')).sort(byName),
    ]

    // 5. Prompt
    const promptTemplate = await this.loadPromptTemplate()
    const userPrompt = this.buildUserPrompt(
      week,
      dailies,
      skipped.missing,
      previous,
      plan,
      checkins,
      healthCsvs,
      priceCsvs,
    )
    const contextTokens = estimateTokens(userPrompt)

    output.log(
      `Context: ${dailies.length} dailies${previous ? ' + previous week' : ''}, ` +
        `~${Math.round(contextTokens / 1000)}k tokens (budget ${CONTEXT_BUDGET_TOKENS / 1000}k)`,
    )

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    // 6. Hard fail over budget — never generate from a trimmed week
    if (contextTokens > CONTEXT_BUDGET_TOKENS) {
      return CommandResult.fail(
        `Week context is ~${Math.round(contextTokens / 1000)}k tokens, over the ${CONTEXT_BUDGET_TOKENS / 1000}k budget. ` +
          'Refusing to generate from a partial week — inspect with --dry-run to find the outlier.',
      )
    }

    // 7. Call Claude
    output.log('Calling Claude...')
    let response: string
    let usage = ''
    try {
      const result = await generateText({
        ...aiModelByProfile(model),
        instructions: promptTemplate,
        prompt: userPrompt,
      })
      response = result.text
      const { inputTokens, outputTokens } = result.usage
      if (inputTokens !== undefined && outputTokens !== undefined) {
        usage = `${inputTokens} in, ${outputTokens} out`
      }
    } catch (err) {
      await logAIError({
        source: 'summary:week',
        stage: 'generate',
        message: err instanceof Error ? err.message : String(err),
      })
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // 8. Build output file
    const yamlHeader: Record<string, unknown> = {
      title: 'Weekly Summary',
      week: week.toString(),
      start: week.start.ymd,
      end: week.end.ymd,
      days: dailies.length,
      generated: new Date().toISOString(),
      model: modelId,
      ...(usage ? { usage } : {}),
      tags: 'Summary/Weekly',
    }
    if (rel.length > 0) {
      yamlHeader.rel = rel
    }

    let outputContent = ['---', stringify(yamlHeader).trim(), '---', '', response].join('\n')

    // Append the SUMMARY-CONTEXT record: what the model read (with token
    // estimates, in shipped order) and which days were skipped and why.
    const baseDir = <string>config.DIR_BASE
    const relPath = (p: string) => (p.startsWith(baseDir) ? p.slice(baseDir.length + 1) : p)
    outputContent += serializeSummaryContext({
      scope: 'week',
      budget: CONTEXT_BUDGET_TOKENS,
      kept: [
        ...priceCsvs.map((p) => ({ path: relPath(p.path), tokens: estimateTokens(p.csv), kind: 'tracking' })),
        ...healthCsvs.map((h) => ({ path: relPath(h.path), tokens: estimateTokens(h.csv), kind: 'tracking' })),
        ...(previous
          ? [{ path: relPath(previous.path), tokens: estimateTokens(previous.body), kind: 'background' }]
          : []),
        ...(plan ? [{ path: relPath(planPath), tokens: estimateTokens(plan), kind: 'plan' }] : []),
        ...(checkins ? [{ path: relPath(checkinsPath), tokens: estimateTokens(checkins), kind: 'checkins' }] : []),
        ...dailies.map((d) => ({ path: relPath(d.path), tokens: estimateTokens(d.body), kind: 'daily-summary' })),
      ],
      skipped: [
        ...(plan ? [] : [{ path: relPath(planPath), reason: 'missing' }]),
        ...(checkins ? [] : [{ path: relPath(checkinsPath), reason: 'missing' }]),
        ...skipped.missing.map((d) => ({
          path: relPath(path.join(timeDir, dayDir(d), 'summary.md')),
          reason: 'missing',
        })),
        ...skipped.tiny.map((d) => ({ path: relPath(path.join(timeDir, dayDir(d), 'summary.md')), reason: 'tiny' })),
        ...skipped.yamlError.map((d) => ({
          path: relPath(path.join(timeDir, dayDir(d), 'summary.md')),
          reason: 'yamlError',
        })),
        ...skipped.unreadable.map((d) => ({
          path: relPath(path.join(timeDir, dayDir(d), 'summary.md')),
          reason: 'unreadable',
        })),
      ],
    })

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
    const content = await readPromptFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'week.prompt.md')
    return output
  }

  private buildUserPrompt(
    week: Week,
    dailies: WeekSummaryEntry[],
    missing: PlainDate[],
    previous: { week: Week; body: string } | undefined,
    plan: string | undefined,
    checkins: string | undefined,
    healthCsvs: WeekHealthCsv[],
    priceCsvs: WeekPriceCsv[],
  ): string {
    const parts: string[] = []

    // Header with week context
    parts.push(`# Weekly Input for ${week.toString()} (${week.start.ymd} – ${week.end.ymd}, Mon–Sun)`)
    parts.push('')
    parts.push(`Days with summaries: ${dailies.length} of ${week.days.length}`)
    if (missing.length > 0) {
      parts.push(`Missing: ${missing.map((d) => `${d.ymd} (${d.dayShort})`).join(', ')}`)
    }
    parts.push('')
    parts.push('Below is the collated input for this week. Generate the Weekly Summary.')
    parts.push('')

    if (priceCsvs.length > 0) {
      parts.push('## Price Data (Raw CSV)')
      parts.push('')
      for (const p of priceCsvs) {
        parts.push(`### ${path.basename(p.path)}`)
        parts.push('```csv')
        parts.push(p.csv)
        parts.push('```')
        parts.push('')
      }
    }

    if (healthCsvs.length > 0) {
      parts.push('## Health Data (Raw CSV)')
      parts.push('')
      for (const h of healthCsvs) {
        parts.push(`### ${h.name}.csv`)
        parts.push('```csv')
        parts.push(h.csv)
        parts.push('```')
        parts.push('')
      }
    }

    parts.push('---')
    parts.push('')

    if (previous) {
      parts.push(`<!-- START PREVIOUS WEEK: ${previous.week.toString()} (background) -->`)
      parts.push(previous.body.trim())
      parts.push(`<!-- END PREVIOUS WEEK: ${previous.week.toString()} -->`)
      parts.push('')
    }

    if (plan) {
      parts.push('<!-- START WEEK PLAN (final state at week end) -->')
      parts.push(plan.trim())
      parts.push('<!-- END WEEK PLAN -->')
      parts.push('')
    }

    if (checkins) {
      parts.push('<!-- START CHECKINS TRAIL -->')
      parts.push(checkins.trim())
      parts.push('<!-- END CHECKINS TRAIL -->')
      parts.push('')
    }

    for (const d of dailies) {
      parts.push(`<!-- START DAILY SUMMARY: ${d.date.ymd} (${d.date.dayShort}) -->`)
      parts.push(d.body.trim())
      parts.push(`<!-- END DAILY SUMMARY: ${d.date.ymd} -->`)
      parts.push('')
    }

    return parts.join('\n')
  }

  private pdfPath(week: Week): string {
    return path.join(DIR_OUTPUT, `${week.toString()}_weekly_summary.pdf`)
  }
}
