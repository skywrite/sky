import * as path from 'node:path'
import { generateText } from 'ai'
import { findRecapFile } from '#commands/all/recap/lib/writeRecapFile.ts'
import { hasNotebookDay } from '#commands/all/slack/pull/lib/dayView.ts'
import { aiEffortFlag } from '#commands/lib/aiParams.ts'
import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT, DIR_STATE_SLACK_DAYS } from '#config'
import { listOwnAddresses } from '#lib/google/ownAddresses.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile, getProfile, type ModelProfile } from '#shared/ai/models.ts'
import { ratioFor } from '#shared/ai/tokenRatio.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import createDayLabeler from '#shared/models/Chat/ChatContext/dayLabel.ts'
import { createChatActivityReader } from '#shared/models/Chat/ChatStore/dayActivity.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { isParticipant } from '#shared/models/Message/mod.ts'
import { dayDir, isActionPath } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { estimatedTokens, fitBudget, modelTokens } from '#universal/ai/readingBudget.ts'
import { Instant, instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { gatherHealthData, type HealthData } from './_health.ts'
import { type DayPriceData, gatherDayPriceData } from './_prices.ts'
import { chatActivityInput, chatActivitySource, chatActivitySources } from './lib/chatActivity.ts'
import { serializeSummaryContext } from './lib/contextRecord.ts'
import gatherDayDocs from './lib/gatherDayDocs.ts'
import { type StreakCompletion, streakCompletion, streakRow } from './lib/streaks.ts'

const PROMPT_FILE = new URL('./prompts/day.prompt.md', import.meta.url).pathname

// The reading budget, in the model's tokens: the day's complete record,
// the Slack recap included, in one request. A profile whose window is
// smaller takes the highest stop that fits (universal/ai/readingBudget.ts).
// Over budget, the day refuses to generate instead of trimming.
const READING_BUDGET_TOKENS = 750_000

// Follow previous: links two hops back — enough to read a reply in thread
// context without dragging in a week-old tail.
const PREVIOUS_HOPS = 2

// The summary is the day's canonical record and feeds every downstream
// consumer — worth the top-tier model.
const DEFAULT_PROFILE = 'default-fable-5.1'

const params = {
  effort: aiEffortFlag(),
  day: dayNoFutureArg(),
  model: Flag.string('Model profile to use', { long: 'ai-model', short: 'm', default: () => DEFAULT_PROFILE }),
  force: Flag.bool('Overwrite existing summary file', { short: 'f', default: false }),
  dryRun: Flag.bool('Show prompt without calling AI', { default: false }),
  stdout: Flag.bool('Output summary to stdout instead of file', { default: false }),
  open: Flag.bool('Open summary in editor after creation', { short: 'o', default: true }),
  export: Flag.bool('Export summary as PDF to ~/Desktop', { short: 'e', default: false }),
}

type Params = InferParams<typeof params>
type Result = { path?: string; pdfPath?: string; dryRun?: boolean; stdout?: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'summary:day': { params: Params; result: Result }
  }
}

export default class SummaryDayTask extends Command {
  static override description: CommandDescription = {
    name: 'summary:day',
    description: "Generate AI-powered daily summary - what got done, what didn't",
    descriptionLong: [
      'Creates a summary.md file in the day directory: the day compressed once, for reading tomorrow and for search later.',
      'Opens with a recognizable headline, a short story, and Meaningful Moments linked to original day files, generated alongside the detailed record.',
      'Detailed sections: Done, Not Done, Commitments Made, Waiting On, Time, Health, Signals, Insights, Archival, Asset Prices - every line names its source file.',
      'Slack channels reach it through the Slack recap that recap:slack writes from the channel cache; a day with channel messages but no recap gets one written first. The recap shapes the summary but is not copied into it.',
      'The day is self-contained: nothing in it depends on another day. A closing Where Things Stand section names what the day touched and where each stood.',
    ],
    usage: [
      'sky summary:day                    # Summarize today',
      'sky summary:day 27                 # Summarize 27th of current month',
      'sky summary:day 2025-12-27         # Summarize specific day',
      'sky summary:day --dry-run          # Preview prompt without calling AI',
      'sky summary:day --force            # Overwrite existing summary',
      'sky summary:day --stdout           # Output to stdout instead of file',
      'sky summary:day --export           # Export existing summary as PDF to ~/Desktop',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output, secrets } = context
    const { day, model, force, dryRun, stdout, open } = args
    const exportPdf = args.export

    const timeDir = <string>config.DIR_TIME
    const dayDirPath = path.join(timeDir, dayDir(day))
    const summaryPath = path.join(dayDirPath, 'summary.md')

    // --export: export existing summary as PDF (no AI generation)
    if (exportPdf) {
      if (!(await exists(summaryPath))) {
        return CommandResult.fail('No summary.md found. Run summary:day first to generate one.')
      }
      const pdfPath = this.pdfPath(day)
      output.log(`Exporting existing summary to PDF...`)
      const result = await tasks.run('markdown:pdf', {
        file: summaryPath,
        output: pdfPath,
        title: `Daily Summary – ${day.ymd}`,
      })
      if (result.status !== 'success') {
        return CommandResult.fail(result.message || 'PDF export failed')
      }
      return CommandResult.success({ path: summaryPath, pdfPath })
    }

    // Check if summary already exists (skip if outputting to stdout or dry-run)
    if (!stdout && !dryRun && !force && (await exists(summaryPath))) {
      return CommandResult.fail('Summary already exists. Use --force to overwrite.')
    }

    // Resolve the profile up front — a bad -m should fail before any work,
    // and the resolved model id gets stamped into the output frontmatter.
    let profile: ModelProfile
    try {
      profile = getProfile(model)
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }
    const modelId = profile.model
    // The budget and every count shown are the model's tokens; the text is
    // measured at four characters a token and restated through the ratio
    // learned for the model.
    const budget = fitBudget(READING_BUDGET_TOKENS, profile.contextWindow)
    const ratio = ratioFor(modelId)

    output.log(`Generating Daily Summary for ${day.ymd}...`)

    // The Slack recap: the day's channels digested by recap:slack. The
    // service writes it once the next day has started; a day summarized
    // before that, or on a machine that missed it, gets it written first.
    if (!(await findRecapFile(day, 'slack', timeDir)) && (await hasNotebookDay(DIR_STATE_SLACK_DAYS, day.ymd))) {
      if (dryRun) {
        output.log(`Slack recap missing: run sky recap:slack ${day.ymd} first for the full input`)
      } else {
        output.log('Writing the Slack recap first...')
        const recap = await tasks.run('recap:slack', { day, noEditor: true })
        if (recap.status !== 'success') return CommandResult.fail(`Slack recap failed: ${recap.message}`)
      }
    }

    // 1. Gather the day's documents in reading order: journals first, actions
    // chronologically, day.md last — HTML comments stripped, summary.md excluded.
    const gathered = await gatherDayDocs(dayDirPath)
    // Whole transcripts may contain later days. Only the dated messages below are activity evidence.
    const docs = gathered.docs.filter((entry) => !isActionPath('chat', entry.path))
    const { skipped } = gathered
    const chatActivity = await createChatActivityReader({
      timeDir,
      baseDir: config.DIR_BASE,
      snapshotDir: config.DIR_STATE_AI_CHATS,
    })(day.ymd)
    if (chatActivity.errors.length)
      return CommandResult.fail(`Could not read chat activity:\n${chatActivity.errors.join('\n')}`)
    const serviceUrl = `http://localhost:${config.PORT_SERVER}`
    const chatInput = chatActivityInput(chatActivity.chats, dayDirPath, serviceUrl)

    const skippedCount = skipped.tiny.length + skipped.yamlError.length + skipped.unreadable.length
    if (skippedCount > 0) {
      output.log(
        `Skipped ${skippedCount} file(s): ${skipped.tiny.length} stub, ${skipped.yamlError.length} bad YAML, ${skipped.unreadable.length} unreadable`,
      )
      for (const p of [...skipped.yamlError, ...skipped.unreadable]) {
        output.log(`  ! ${p}`)
      }
    }

    if (docs.length === 0 && !chatActivity.chats.length) {
      return CommandResult.fail('No files found for this day')
    }

    // 2. Build the MarkdownStore for entity resolution
    output.log('Building entity store...')
    const store = await MarkdownStore.build({
      peopleDirs: [<string>config.DIR_PEOPLE, <string>config.DIR_PEOPLE_OLD],
      orgDirs: [<string>config.DIR_ORGS],
      projectsDir: <string>config.DIR_PROJECTS,
      decisionsDir: <string>config.DIR_DECISIONS,
      timeDirs: [timeDir],
    })

    // 3. Build DomainCollection - this resolves relationships to people, orgs, projects
    output.log('Building domain collection with resolved relationships...')
    const collection = DomainCollection.fromDocuments(docs, store, { depth: 1, previousHops: PREVIOUS_HOPS })

    const healthData = await gatherHealthData(day, timeDir)
    const priceData = await gatherDayPriceData(day, <string>config.DIR_DATA)

    // Archival captures: message files the owner appears nowhere in — threads
    // saved for reference, not activity. Identity comes from me/about.md, the
    // same source as the prompt's {{me.*}} variables, plus every address the
    // owner's mail uses (connected Google accounts and their Gmail aliases);
    // without a name, nothing is marked and the summary reads as before.
    const ownerNames = await this.loadOwnerNames(<string>config.FILE_ABOUT_ME)
    const ownerAddresses = ownerNames.some(Boolean) ? await listOwnAddresses(secrets) : []
    const archivalPaths = new Set(
      docs
        .filter((d) => isActionPath('message', d.path) && !isParticipant(d.doc, ownerNames, ownerAddresses))
        .map((d) => d.path),
    )

    // Location metadata from the already-gathered day.md
    const dayEntry = docs.find((d) => d.kind === 'day')
    const location = dayEntry?.doc.yaml['location'] as string | undefined

    // Streaks reach the model as the day's completion only. The day file's
    // own list carries running counts, which depend on other days and would
    // be wrong in a write-once file when days are ended out of order.
    const streaks = dayEntry ? streakCompletion(dayEntry.doc.toMarkdown()) : null

    // 4. Collate: background section first (entities and thread antecedents,
    // type-priority order), then the day's documents in gathered order —
    // day.md stays last, closest to the generation point, so the model can
    // lean on it.
    const baseDir = <string>config.DIR_BASE
    const rootPaths = new Set(docs.map((d) => d.path))
    const background = collection.allItems
      .filter((item) => !rootPaths.has(item.path) && !isActionPath('chat', item.path))
      .map((i) => ({ doc: i.doc.stripHtmlComments(), path: i.path }))
    // Stamp each dated document relative to the summarized day - its own docs
    // read (TODAY), thread antecedents (N days ago) - so the model never infers
    // a document's day from its neighbours.
    const dayLabel = createDayLabeler(day)
    const sections = [
      Collection.from(background).toMarkdown({
        relativeTo: baseDir,
        delimited: true,
        label: dayLabel,
      }),
      chatInput,
      Collection.from(docs.map((d) => ({ doc: d.doc, path: d.path }))).toMarkdown({
        relativeTo: timeDir,
        delimited: true,
        sorted: false,
        label: (p) =>
          [dayLabel(p), archivalPaths.has(p) ? 'ARCHIVAL' : undefined].filter(Boolean).join(' | ') || undefined,
      }),
    ]
    const collatedMarkdown = sections.filter((s) => s.length > 0).join('\n\n')
    const contextTokens = modelTokens(estimateTokens(collatedMarkdown), ratio)

    // 5. Extract rel for output file metadata — alphabetical within each type group
    const byName = (a: string, b: string) => a.localeCompare(b)
    const rel: string[] = [
      ...collection.orgs.map((o) => o.name).sort(byName),
      ...collection.people.map((p) => p.name).sort(byName),
      ...collection.projects.map((p) => `projects/${p.name}`).sort(byName),
    ]

    // 6. Load prompt template
    const promptTemplate = await this.loadPromptTemplate()

    // 7. Build user prompt (date context + collated markdown + health data + prices + location)
    const userPrompt = this.buildUserPrompt(day, collatedMarkdown, healthData, priceData, location, streaks)

    const kinds = { journal: 0, action: 0, day: 0 }
    for (const d of docs) kinds[d.kind]++
    output.log(`Day documents: ${docs.length} (${kinds.journal} journal, ${kinds.action} actions, ${kinds.day} day)`)
    if (archivalPaths.size > 0) {
      output.log(`Archival captures (owner not a participant): ${archivalPaths.size}`)
    }
    output.log(`Collection: ${collection.size} documents`)
    output.log(`  - Orgs: ${collection.orgs.length}`)
    output.log(`  - People: ${collection.people.length}`)
    output.log(`  - Projects: ${collection.projects.length}`)
    output.log(
      `Context: ${docs.length + background.length} docs, ~${Math.round(contextTokens / 1000)}k tokens (budget ${Math.round(budget / 1000)}k)`,
    )

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    // 8. Hard fail over budget — never generate from a trimmed day
    if (contextTokens > budget) {
      return CommandResult.fail(
        `Day context is ~${Math.round(contextTokens / 1000)}k tokens, over the ${Math.round(budget / 1000)}k budget. ` +
          'Refusing to generate from a partial day — inspect with --dry-run to find the outlier.',
      )
    }

    // 9. Call Claude
    output.log('Calling Claude...')
    let response: string
    let usage = ''
    try {
      const result = await generateText({
        ...aiModelByProfile(model, { effort: args.effort }),
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
        source: 'summary:day',
        stage: 'generate',
        message: err instanceof Error ? err.message : String(err),
      })
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // 10. Build output file
    const yamlHeader: Record<string, unknown> = {
      title: 'Daily Summary',
      day: day.ymd,
      generated: Instant.from(instantNow()).toString(),
      model: modelId,
      ...(usage ? { usage } : {}),
      tags: 'Summary/Daily',
    }

    // Add rel if there are any orgs, people, or projects
    if (rel.length > 0) {
      yamlHeader.rel = rel
    }

    let outputContent = ['---', stringify(yamlHeader).trim(), '---', '', response].join('\n')
    outputContent += chatActivitySources(chatActivity.chats, dayDirPath, serviceUrl)

    // Append the SUMMARY-CONTEXT record: what the model read (with token
    // estimates, in shipped order) and what was skipped, for staleness
    // detection and missing-input debugging.
    const relPath = (p: string) => (p.startsWith(baseDir) ? p.slice(baseDir.length + 1) : p)
    const skipReasons: Array<[string[], string]> = [
      [skipped.tiny, 'tiny'],
      [skipped.yamlError, 'yamlError'],
      [skipped.unreadable, 'unreadable'],
    ]
    // The record counts as the pipeline measures, four characters a token,
    // the budget restated to match.
    outputContent += serializeSummaryContext({
      scope: 'day',
      budget: estimatedTokens(budget, ratio),
      kept: [
        ...chatActivity.chats.map((chat) => ({
          path: chat.path ? path.relative(baseDir, chat.path) : chatActivitySource(chat, dayDirPath, serviceUrl),
          tokens: estimateTokens(chatActivityInput([chat], dayDirPath, serviceUrl)),
          kind: 'chat-day',
        })),
        ...background.map((b) => ({
          path: relPath(b.path),
          tokens: estimateTokens(b.doc.toMarkdown()),
          kind: 'background',
        })),
        ...docs.map((d) => ({ path: relPath(d.path), tokens: estimateTokens(d.doc.toMarkdown()), kind: d.kind })),
      ],
      skipped: skipReasons.flatMap(([paths, reason]) =>
        paths.map((p) => ({ path: relPath(path.join(dayDirPath, p)), reason })),
      ),
    })

    // 11. Output
    if (stdout) {
      output.log(outputContent)
      return CommandResult.success({ stdout: true })
    }

    // Write file
    await writeTextFile(summaryPath, outputContent)
    output.log(`Daily Summary written to ${summaryPath}`)

    // 12. Open in editor if requested
    if (open) {
      await openEditor([{ file: summaryPath }])
    }

    return CommandResult.success({ path: summaryPath })
  }

  private async loadOwnerNames(aboutMePath: string): Promise<string[]> {
    try {
      const me = AboutMeDocument.fromMarkdown(await readTextFile(aboutMePath))
      return [me.fullName, me.firstName]
    } catch {
      return []
    }
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readPromptFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'day.prompt.md')
    return output
  }

  private buildUserPrompt(
    day: PlainDate,
    collatedMarkdown: string,
    healthData: HealthData,
    priceData: DayPriceData,
    location?: string,
    streaks: StreakCompletion | null = null,
  ): string {
    const parts: string[] = []

    // Header with date context
    parts.push(`# Daily Input for ${day.ymd} (${day.dayShort})`)
    parts.push('')
    parts.push(`**Summary directory (relative to time/):** ${dayDir(day)}`)
    parts.push('')
    if (location) {
      parts.push(`**Location**: ${location}`)
      parts.push('')
    }
    parts.push('Below is the collated input for this day. Generate the Daily Summary.')
    parts.push('')

    // Price data section
    if (priceData.prices.length > 0) {
      parts.push('## Prices')
      parts.push('')
      for (const p of priceData.prices) {
        const formatted =
          p.value >= 1000 ? p.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.value.toFixed(2)
        parts.push(`- **${p.symbol}**: $${formatted}`)
      }
      parts.push('')
    }

    // Health data section (if any data exists)
    if (
      healthData.sleep ||
      healthData.weight ||
      healthData.strength ||
      healthData.distance ||
      healthData.work ||
      streaks
    ) {
      parts.push('## Health Data')
      parts.push('')

      if (healthData.sleep) {
        parts.push(`- **Sleep**: ${healthData.sleep.range} (${healthData.sleep.duration} hrs)`)
      }

      if (healthData.weight) {
        parts.push(`- **Weight**: ${healthData.weight} lbs`)
      }

      if (healthData.strength) {
        for (const s of healthData.strength) {
          const durationPart = s.duration ? `, ${s.duration} mins` : ''
          const notesPart = s.notes ? ` - ${s.notes}` : ''
          parts.push(`- **Strength**: ${s.time}, ${s.lbs} lbs${durationPart}${notesPart}`)
        }
      }

      if (healthData.distance) {
        const totalMiles = healthData.distance.reduce((sum, d) => sum + (parseFloat(d.miles) || 0), 0)
        const totalMins = healthData.distance.reduce((sum, d) => sum + (parseFloat(d.duration) || 0), 0)
        const pace = totalMiles > 0 ? (totalMins / totalMiles).toFixed(1) : null
        const pacePart = pace ? `, ${pace} min/mi avg` : ''
        parts.push(`- **Distance**: ${totalMiles.toFixed(1)} mi, ${Math.round(totalMins)} mins${pacePart}`)
      }

      if (healthData.work) {
        const notesPart = healthData.work.notes ? ` - ${healthData.work.notes}` : ''
        parts.push(`- **Work**: ${healthData.work.duration} hrs${notesPart}`)
      }

      // Completion only - the day's own fact. Counts never reach the model.
      if (streaks) {
        parts.push(`- **Streaks**: ${streakRow(streaks)}`)
      }

      parts.push('')
    }

    parts.push('---')
    parts.push('')

    // The collated markdown from DomainCollection
    parts.push(collatedMarkdown)

    return parts.join('\n')
  }

  private pdfPath(day: PlainDate): string {
    return path.join(DIR_OUTPUT, `${day.ymd}_summary.pdf`)
  }
}
