import * as path from 'node:path'
import { generateText } from 'ai'
import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile, getProfile } from '#shared/ai/models.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createSummaryScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { gatherHealthData, type HealthData } from './_health.ts'
import { type DayPriceData, gatherDayPriceData } from './_prices.ts'
import gatherDayDocs from './lib/gatherDayDocs.ts'

const PROMPT_FILE = new URL('./prompts/day.prompt.md', import.meta.url).pathname

// Outlier guard, not a target: a normal day's context sits well under this,
// so nothing is pruned. It exists to keep a runaway day (huge chats, dozens
// of entity pulls) from swamping the model.
const CONTEXT_BUDGET_TOKENS = 120_000

// Follow previous: links two hops back — enough to read a reply in thread
// context without dragging in a week-old tail.
const PREVIOUS_HOPS = 2

// The summary is the day's canonical record and feeds every downstream
// consumer — worth the top-tier model.
const DEFAULT_PROFILE = 'default-fable-5'

const params = {
  day: dayNoFutureArg(),
  model: Flag.string('Model profile to use', { short: 'm', default: () => DEFAULT_PROFILE }),
  force: Flag.bool('Overwrite existing summary file', { short: 'f', default: false }),
  dryRun: Flag.bool('Show prompt without calling AI', { default: false }),
  stdout: Flag.bool('Output summary to stdout instead of file', { default: false }),
  open: Flag.bool('Open summary in editor after creation', { short: 'o', default: false }),
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
      'Creates a summary.md file in the day directory.',
      'Facts-first mirror: Done, Not Done, Commitments Made, Health, Signals.',
      'Feeds into weekly summary for planning.',
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
    const { config, output } = context
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
      const result = await tasks.run<{ pdfPath: string }>('markdown:pdf', {
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
    let modelId: string
    try {
      modelId = getProfile(model).model
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    output.log(`Generating Daily Summary for ${day.ymd}...`)

    // 1. Gather the day's documents in reading order: journals first, actions
    // chronologically, day.md last — HTML comments stripped, summary.md excluded.
    const { docs, skipped } = await gatherDayDocs(dayDirPath)

    const skippedCount = skipped.tiny.length + skipped.yamlError.length + skipped.unreadable.length
    if (skippedCount > 0) {
      output.log(
        `Skipped ${skippedCount} file(s): ${skipped.tiny.length} stub, ${skipped.yamlError.length} bad YAML, ${skipped.unreadable.length} unreadable`,
      )
      for (const p of [...skipped.yamlError, ...skipped.unreadable]) {
        output.log(`  ! ${p}`)
      }
    }

    if (docs.length === 0) {
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
    const priceData = await gatherDayPriceData(day, <string>config.DIR_TRACKING)

    // Location metadata from the already-gathered day.md
    const dayEntry = docs.find((d) => d.kind === 'day')
    const location = dayEntry?.doc.yaml['location'] as string | undefined

    // 4. Score and budget the collection, then collate: background section
    // first (entities and thread antecedents, type-priority order), then the
    // day's kept documents in gathered order — day.md stays last, closest to
    // the generation point, so the model can lean on it.
    const assembler = ContextAssembler.from(collection, {
      scorer: createSummaryScorer(dayDirPath),
      maxTokens: CONTEXT_BUDGET_TOKENS,
    })

    const baseDir = <string>config.DIR_BASE
    const rootPaths = new Set(docs.map((d) => d.path))
    const keptPaths = new Set(assembler.kept.map((s) => s.item.path))
    const background = assembler.kept.filter((s) => !rootPaths.has(s.item.path)).map((s) => s.item)
    const dayStream = docs.filter((d) => keptPaths.has(d.path))
    const sections = [
      Collection.from(background.map((i) => ({ doc: i.doc.stripHtmlComments(), path: i.path }))).toMarkdown({
        relativeTo: baseDir,
        delimited: true,
      }),
      Collection.from(dayStream.map((d) => ({ doc: d.doc, path: d.path }))).toMarkdown({
        relativeTo: timeDir,
        delimited: true,
        sorted: false,
      }),
    ]
    const collatedMarkdown = sections.filter((s) => s.length > 0).join('\n\n')

    // 5. Extract rel for output file metadata
    const rel: string[] = [
      ...collection.orgs.map((o) => o.name),
      ...collection.people.map((p) => p.name),
      ...collection.projects.map((p) => `projects/${p.name}`),
    ]

    // 6. Load prompt template
    const promptTemplate = await this.loadPromptTemplate()

    // 7. Build user prompt (date context + collated markdown + health data + prices + location)
    const userPrompt = this.buildUserPrompt(day, collatedMarkdown, healthData, priceData, location)

    const kinds = { journal: 0, action: 0, day: 0 }
    for (const d of docs) kinds[d.kind]++
    output.log(`Day documents: ${docs.length} (${kinds.journal} journal, ${kinds.action} actions, ${kinds.day} day)`)
    output.log(`Collection: ${collection.size} documents`)
    output.log(`  - Orgs: ${collection.orgs.length}`)
    output.log(`  - People: ${collection.people.length}`)
    output.log(`  - Projects: ${collection.projects.length}`)
    output.log(
      `Context: ${assembler.size} docs kept (~${Math.round(assembler.totalTokens / 1000)}k tokens), ${assembler.pruned.length} pruned`,
    )
    for (const s of assembler.pruned) {
      output.log(`  pruned: ${path.relative(baseDir, s.item.path)}`)
    }
    if (assembler.overBudget) {
      output.log('Warning: kept documents exceed the context budget on their own')
    }

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    // 8. Call Claude
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
        source: 'summary:day',
        stage: 'generate',
        message: err instanceof Error ? err.message : String(err),
      })
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // 9. Build output file
    const yamlHeader: Record<string, unknown> = {
      title: 'Daily Summary',
      day: day.ymd,
      generated: new Date().toISOString(),
      model: modelId,
      ...(usage ? { usage } : {}),
      tags: 'Summary/Daily',
    }

    // Add rel if there are any orgs, people, or projects
    if (rel.length > 0) {
      yamlHeader.rel = rel
    }

    let outputContent = ['---', stringify(yamlHeader).trim(), '---', '', response].join('\n')

    // Append context file paths as hidden comment (same pattern as ai:chat).
    // Kept documents only — this records what the model actually read.
    const contextPaths = assembler.kept.map((s) => s.item.path)
    if (contextPaths.length > 0) {
      const relativePaths = contextPaths
        .map((p) => {
          if (p.startsWith(timeDir)) return p.slice(timeDir.length + 1)
          if (p.startsWith(baseDir)) return p.slice(baseDir.length + 1)
          return p
        })
        .sort()
      const pathLines = relativePaths.map((p) => ` - ${p}`).join('\n')
      outputContent += '\n\n\n<!--\nCONTEXT:\n\n' + pathLines + '\n\nEND\n-->\n'
    }

    // 10. Output
    if (stdout) {
      output.log(outputContent)
      return CommandResult.success({ stdout: true })
    }

    // Write file
    await writeTextFile(summaryPath, outputContent)
    output.log(`Daily Summary written to ${summaryPath}`)

    // 11. Open in editor if requested
    if (open) {
      await openEditor([{ file: summaryPath }])
    }

    return CommandResult.success({ path: summaryPath })
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'day.prompt.md')
    return output
  }

  private buildUserPrompt(
    day: PlainDate,
    collatedMarkdown: string,
    healthData: HealthData,
    priceData: DayPriceData,
    location?: string,
  ): string {
    const parts: string[] = []

    // Header with date context
    parts.push(`# Daily Input for ${day.ymd} (${day.dayShort})`)
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
    if (healthData.sleep || healthData.weight || healthData.strength || healthData.distance || healthData.work) {
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

      parts.push('')
    }

    parts.push('---')
    parts.push('')

    // The collated markdown from DomainCollection
    parts.push(collatedMarkdown)

    return parts.join('\n')
  }

  private pdfPath(day: PlainDate): string {
    const home = env.get('HOME') ?? '/tmp'
    return path.join(home, 'Desktop', `${day.ymd}_summary.pdf`)
  }
}
