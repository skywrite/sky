import * as path from 'node:path'
import { generateText } from 'ai'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import openEditor from '#lib/shell/openEditor.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile, getProfile } from '#shared/ai/models.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { fetchNow, weekDir } from '#shared/nbfs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { type CheckinContext, formatCheckinContext, gatherCheckinContext } from './lib/checkinContext.ts'
import { appendCheckin, dayNumberInWeek, entryHeading, renderCheckinsFile, unpadHour } from './lib/checkinsMarkdown.ts'
import { stripCodeFence } from './lib/draftWeek.ts'

const PROMPT_FILE = path.join(import.meta.dir, 'prompts', 'checkin.prompt.md')

// Hard ceiling matching the summaries. A week-in-flight (plan + trail + a few
// days of record) lands far below it; over budget refuses instead of trimming.
const CONTEXT_BUDGET_TOKENS = 300_000

// Grading is judgment against the record — same top-tier model as the
// summaries the record is made of.
const DEFAULT_PROFILE = 'default-fable-5'

const params = {
  week: Arg.string('Week to check in on (e.g., 35, W35, 2026-W02) — defaults to the current week', {
    optional: true,
  }),
  model: Flag.string('Model profile to use', { short: 'm', default: () => DEFAULT_PROFILE }),
  dryRun: Flag.bool('Show prompt without calling AI', { default: false }),
  stdout: Flag.bool('Print the entry instead of writing checkins.md', { default: false }),
  open: Flag.bool('Open checkins.md in editor after writing', { short: 'o', default: true }),
}

type Params = InferParams<typeof params>
type Result = { path?: string; dryRun?: boolean; stdout?: boolean }

export default class WeekCheckinTask extends Command {
  static override description: CommandDescription = {
    name: 'week:checkin',
    description: 'Grade the week in flight against its plan; append the entry to checkins.md.',
    descriptionLong: [
      'Reads week.md and the lived record so far — day summaries (or raw day.md for days',
      'without one), journals, most-important files, health CSVs — and grades the week:',
      'a letter grade, per-goal status with evidence, a priority-allocation check, plan',
      'drift, and suggested plan edits.',
      '',
      'The entry appends to checkins.md next to week.md. The first run captures a verbatim',
      'snapshot of week.md — the original plan the end-of-week deviation is measured',
      "against. week.md itself is never touched: it stays the user's pen, and suggestions",
      'are applied by hand or not at all.',
      '',
      'Run any day of the week. On day 7 — or on a completed week — the entry is the final',
      'reckoning against both the original and the final plan.',
    ],
    usage: [
      'sky week:checkin                # Check in on the current week',
      'sky week:checkin 34             # Final-reckon a completed week',
      'sky week:checkin --dry-run      # Preview the prompts without calling AI',
      'sky week:checkin --stdout       # Print the entry; write nothing',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { model, dryRun, stdout, open } = args

    const now = await fetchNow()
    const today = now.plainDateTime.plainDate
    const current = Week.of(now)

    let week: Week
    try {
      week = args.week ? Week.parse(args.week, current.year) : current
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    if (PlainDate.compare(week.start, today) > 0) {
      return CommandResult.fail(`${week.toString()} hasn't started yet — nothing to grade.`)
    }

    const weekDirPath = path.join(DIR_TIME, weekDir(week.startInYear))
    const weekMdPath = path.join(weekDirPath, 'week.md')
    if (!(await exists(weekMdPath))) {
      let hint = ''
      if (!args.week) {
        const prev = week.previous()
        if (await exists(path.join(DIR_TIME, weekDir(prev.startInYear), 'week.md'))) {
          hint = `\nTo grade the completed ${prev.toString()}: week:checkin ${prev.number}`
        }
      }
      return CommandResult.fail(
        `${week.toString()} has no week.md — nothing to grade against. Run week:plan ${week.number} first.${hint}`,
      )
    }

    // Resolve the profile up front — a bad -m should fail before any work,
    // and the resolved model id is stamped into the entry's provenance line.
    let modelId: string
    try {
      modelId = getProfile(model).model
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    const weekMd = await readTextFile(weekMdPath)
    const checkinsPath = path.join(weekDirPath, 'checkins.md')
    const existing = (await exists(checkinsPath)) ? await readTextFile(checkinsPath) : undefined

    output.log(`Checking in on ${week.toString()} (${week.start.ymd} – ${week.end.ymd})...`)
    const checkinContext = await gatherCheckinContext(week, today)
    output.log(`${colors.cyan('Grading from:')}\n  ${checkinContext.manifest.join('\n  ')}`)

    const promptTemplate = await this.loadPromptTemplate()
    const userPrompt = this.buildUserPrompt(week, today, now.plainDateTime.time, weekMd, existing, checkinContext)
    const contextTokens = estimateTokens(userPrompt)
    output.log(`Context: ~${Math.round(contextTokens / 1000)}k tokens (budget ${CONTEXT_BUDGET_TOKENS / 1000}k)`)

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    if (contextTokens > CONTEXT_BUDGET_TOKENS) {
      return CommandResult.fail(
        `Checkin context is ~${Math.round(contextTokens / 1000)}k tokens, over the ${CONTEXT_BUDGET_TOKENS / 1000}k budget. ` +
          'Inspect with --dry-run to find the outlier.',
      )
    }

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
        source: 'week:checkin',
        stage: 'generate',
        message: err instanceof Error ? err.message : String(err),
      })
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // The system stamps the heading; strip one if the model added its own.
    const body = stripCodeFence(response)
      .replace(/^## Checkin[^\n]*\n+/, '')
      .trim()
    if (!body) {
      await logAIError({ source: 'week:checkin', stage: 'generate', message: 'model returned an empty entry' })
      return CommandResult.fail('Model returned an empty entry — nothing written.')
    }

    const heading = entryHeading(week, today, now.plainDateTime.time)
    const provenance = `<!-- model: ${modelId}${usage ? ` · ${usage}` : ''} -->`
    const entry = [heading, provenance, '', body].join('\n')
    const gradeLine = (body.split('\n').find((line) => line.trim()) ?? '').replace(/\*\*/g, '')

    if (stdout) {
      output.log(`\n${entry}`)
      return CommandResult.success({ stdout: true })
    }

    const first = existing === undefined
    await writeTextFile(
      checkinsPath,
      first ? renderCheckinsFile(week, today.ymd, weekMd, entry) : appendCheckin(existing, entry, today.ymd),
    )

    if (first) output.log(`Plan snapshot captured — the original ${week.toString()} plan is preserved in checkins.md`)
    output.log(gradeLine)
    output.log(`Checkin appended to ${checkinsPath}`)

    if (open) {
      await openEditor([{ file: checkinsPath }])
    }

    return CommandResult.success({ path: checkinsPath })
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'checkin.prompt.md')
    return output
  }

  private buildUserPrompt(
    week: Week,
    today: PlainDate,
    time: string,
    weekMd: string,
    existing: string | undefined,
    checkinContext: CheckinContext,
  ): string {
    const n = dayNumberInWeek(week, today)
    const position =
      n === undefined ? 'the week is complete — this is the final reckoning' : `day ${n} of ${week.days.length}`

    const parts: string[] = [
      `# Checkin input for ${week.toString()} (${week.start.dayShort} ${week.start.ymd} – ${week.end.dayShort} ${week.end.ymd})`,
      '',
      `Now: ${today.dayShort} ${today.ymd} ${unpadHour(time)} — ${position}.`,
      '',
      'Generate the checkin entry body.',
      '',
      '== CURRENT PLAN (week.md) ==',
      weekMd.trim(),
      '',
    ]

    if (existing) {
      parts.push('== CHECKINS SO FAR (the "Plan snapshot" section is the original plan) ==', existing.trim(), '')
    } else {
      parts.push(
        '== CHECKINS SO FAR ==',
        '(none — this is the first checkin; the plan snapshot is captured from the current plan this run)',
        '',
      )
    }

    if (checkinContext.healthCsvs.length > 0) {
      parts.push('== HEALTH DATA (week to date, raw CSV) ==', '')
      for (const csv of checkinContext.healthCsvs) {
        parts.push(`### ${csv.name}.csv`, '```csv', csv.csv, '```', '')
      }
    }

    parts.push('== NOTEBOOK CONTEXT ==', formatCheckinContext(checkinContext))

    return parts.join('\n')
  }
}
